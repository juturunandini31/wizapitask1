import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactFlow, { Background, Controls } from 'reactflow'
import 'reactflow/dist/style.css'
import './App.css'

const DEFAULT_JSON = `{
  "user": {
    "name": "Nandini",
    "age": 23,
    "address": { "city": "Bangalore", "area": "HSR" },
    "native": "Andhra"
  }
}`

const NODE_COLORS = {
  object: '#6C63FF', 
  array: '#27AE60', 
  primitive: '#F39C12', 
  highlight: '#FF3B30',
}

const H_GAP = 200
const V_GAP = 110

function detectType(v) {
  if (Array.isArray(v)) return 'array'
  if (v !== null && typeof v === 'object') return 'object'
  return 'primitive'
}

function buildTree(data, rootKey = 'root') {
  const root = { id: '$', key: rootKey, type: detectType(data), value: data, children: [] }

  if (root.type === 'object') {
    const keys = Object.keys(data)
    if (keys.length === 1) {
      const k = keys[0]
      const v = data[k]
      root.id = `$.${k}`
      root.key = k
      root.value = v
      root.type = detectType(v)
    }
  }

  const baseValue = root.value
  const basePath = root.id
  const stack = [[root, baseValue, basePath]]
  while (stack.length) {
    const [node, value, path] = stack.pop()
    if (node.type === 'object') {
      Object.keys(value).forEach((k) => {
        const childVal = value[k]
        const childPath = `${path}.${k}`
        const child = { id: childPath, key: k, type: detectType(childVal), value: childVal, children: [] }
        node.children.push(child)
        if (child.type !== 'primitive') stack.push([child, childVal, childPath])
      })
    } else if (node.type === 'array') {
      value.forEach((v, i) => {
        const childPath = `${path}[${i}]`
        const child = { id: childPath, key: String(i), type: detectType(v), value: v, children: [] }
        node.children.push(child)
        if (child.type !== 'primitive') stack.push([child, v, childPath])
      })
    }
  }
  return root
}

function computeWidths(node) {
  if (!node.children.length) {
    node.width = 1
    return 1
  }
  let sum = 0
  node.children.forEach((c) => {
    sum += computeWidths(c)
  })
  node.width = Math.max(1, sum)
  return node.width
}

function layoutTree(node, xStart, depth, xGap = H_GAP, yGap = V_GAP) {
  // Center children under current segment
  const center = xStart + (node.width * xGap) / 2
  node.position = { x: center, y: depth * yGap }
  let cursor = xStart
  node.children.forEach((c) => {
    layoutTree(c, cursor, depth + 1, xGap, yGap)
    cursor += c.width * xGap
  })
}

function mapToFlow(node, colors, highlightId) {
  const nodes = []
  const edges = []

  const labelFor = (n) => {
    if (n.type === 'primitive') {
      const v = n.value === null ? 'null' : typeof n.value === 'string' ? `"${n.value}"` : String(n.value)
      return n.key ? `${n.key}: ${v}` : v
    }
    if (n.type === 'object') return n.key || 'object'
    if (n.type === 'array') return n.key || 'array'
    return String(n.key)
  }

  const colorFor = (n) => (n.id === highlightId ? colors.highlight : colors[n.type])

  const stack = [node]
  while (stack.length) {
    const n = stack.pop()
    nodes.push({
      id: n.id,
      position: n.position,
      data: { label: labelFor(n), tooltip: `${n.id} => ${labelFor(n)}` },
      style: {
        padding: 10,
        borderRadius: 16,
        fontSize: 12,
        color: '#fff',
        background: colorFor(n),
        border: `2px solid ${n.id === highlightId ? '#b00000' : 'rgba(0,0,0,0.18)'}`,
        boxShadow: '0 6px 16px rgba(0,0,0,0.12)'
      },
      sourcePosition: 'bottom',
      targetPosition: 'top',
    })
    n.children.forEach((c) => {
      edges.push({ id: `${n.id}->${c.id}`, source: n.id, target: c.id, type: 'smoothstep', animated: false })
      stack.push(c)
    })
  }
  return { nodes, edges }
}

function parsePath(query) {
  if (!query) return []
  let s = query.trim()
  if (s.startsWith('$')) s = s.slice(1)
  if (s.startsWith('.')) s = s.slice(1)
  const tokens = []
  let buf = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '.') {
      if (buf) { tokens.push(buf); buf = '' }
    } else if (ch === '[') {
      if (buf) { tokens.push(buf); buf = '' }
      let j = s.indexOf(']', i)
      if (j === -1) return []
      const inside = s.slice(i + 1, j)
      const idx = Number(inside)
      if (!Number.isInteger(idx)) return []
      tokens.push(idx)
      i = j
    } else {
      buf += ch
    }
  }
  if (buf) tokens.push(buf)
  return tokens
}

function findByPath(data, tokens) {
  let cur = data
  let path = '$'
  for (const t of tokens) {
    if (typeof t === 'number') {
      if (!Array.isArray(cur) || t < 0 || t >= cur.length) return null
      cur = cur[t]
      path += `[${t}]`
    } else {
      if (cur == null || typeof cur !== 'object' || !(t in cur)) return null
      cur = cur[t]
      path += `.${t}`
    }
  }
  return { value: cur, path }
}

function App() {
  const flowRef = useRef(null)
  const debounceRef = useRef(null)
  const [jsonText, setJsonText] = useState(DEFAULT_JSON)
  const [error, setError] = useState('')
  const [graph, setGraph] = useState({ nodes: [], edges: [] })
  const [raw, setRaw] = useState(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [highlightId, setHighlightId] = useState(null)
  const [theme, setTheme] = useState('light')

  const generate = useCallback(() => {
    setStatus('')
    setHighlightId(null)
    try {
      const data = JSON.parse(jsonText)
      setRaw(data)
      const tree = buildTree(data, 'root')
      computeWidths(tree)
      layoutTree(tree, 0, 0)
      const { nodes, edges } = mapToFlow(tree, NODE_COLORS, null)
      const minX = Math.min(...nodes.map((n) => n.position.x))
      nodes.forEach((n) => (n.position.x = n.position.x - minX + 40))
      setGraph({ nodes, edges })
      setError('')
      setTimeout(() => {
        if (flowRef.current) flowRef.current.fitView({ padding: 0.2, duration: 400 })
      }, 0)
    } catch (e) {
      setError('Invalid JSON')
      setGraph({ nodes: [], edges: [] })
      setRaw(null)
    }
  }, [jsonText])

  useEffect(() => {
    generate()
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      try {
        JSON.parse(jsonText)
        generate()
      } catch (_) {
      }
    }, 500)
    return () => debounceRef.current && clearTimeout(debounceRef.current)
  }, [jsonText, generate])

  const onSearch = useCallback(() => {
    if (!raw) { setStatus('No tree. Paste JSON and Generate first.'); return }
    const tokens = parsePath(query)
    if (!tokens.length && query.trim()) { setStatus('No match found'); return }
    const res = tokens.length ? findByPath(raw, tokens) : { path: '$', value: raw }
    if (!res) { setStatus('No match found'); setHighlightId(null); return }
    setStatus('Match found')
    setHighlightId(res.path)
    setGraph((g) => {
      const tree = buildTree(raw, 'root')
      computeWidths(tree)
      layoutTree(tree, 0, 0)
      const mapped = mapToFlow(tree, NODE_COLORS, res.path)
      const minX = Math.min(...mapped.nodes.map((n) => n.position.x))
      mapped.nodes.forEach((n) => (n.position.x = n.position.x - minX + 40))
      setTimeout(() => {
        const node = mapped.nodes.find((n) => n.id === res.path)
        if (flowRef.current && node) {
          const inst = flowRef.current
          inst.setCenter(node.position.x, node.position.y, { zoom: 1.2, duration: 600 })
        }
      }, 0)
      return mapped
    })
  }, [query, raw])

  const onInit = useCallback((instance) => {
    flowRef.current = instance
  }, [])

  const onNodeClick = useCallback((_, node) => {
    navigator.clipboard?.writeText(node.id)
    setStatus(`Copied path: ${node.id}`)
  }, [])

  const header = useMemo(() => 'JSON Tree Visualizer', [])

  useEffect(() => {
    const cls = theme === 'dark' ? 'dark' : 'light'
    document.body.classList.remove('light', 'dark')
    document.body.classList.add(cls)
  }, [theme])

  const clearAll = useCallback(() => {
    setJsonText('')
    setGraph({ nodes: [], edges: [] })
    setRaw(null)
    setQuery('')
    setStatus('')
    setError('')
    setHighlightId(null)
  }, [])

  return (
    <div className="app">
      <div className="panel">
        <div className="title-row">
          <h1>{header}</h1>
          <label className="toggle"><input type="checkbox" checked={theme==='dark'} onChange={(e)=>setTheme(e.target.checked? 'dark':'light')} /> <span>Dark/Light</span></label>
        </div>

        <label className="label">Paste or type JSON data</label>
        <textarea
          className="json-input"
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          spellCheck={false}
        />
        {error && <div className="error">{error}</div>}
        <div className="row gap">
          <button className="primary" onClick={generate}>Generate Tree</button>
          <button className="ghost" onClick={clearAll}>Clear</button>
        </div>

        <div className="search-row">
          <input
            className="search"
            placeholder="$.user.address.city or items[0].name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSearch()}
          />
          <button className="secondary" onClick={onSearch}>Search</button>
        </div>
        {status && <div className="status">{status}</div>}
      </div>

      <div className="canvas">
        <ReactFlow
          style={{ width: '100%', height: '100%' }}
          nodes={graph.nodes}
          edges={graph.edges}
          onInit={onInit}
          onNodeClick={onNodeClick}
          fitView
        >
          <Background gap={16} />
          <Controls position="bottom-right" />
        </ReactFlow>
      </div>
    </div>
  )
}

export default App
