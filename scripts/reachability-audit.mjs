// 一次性审计脚本：分类不可达文件——纯死代码 / 有测试但未接线 / 被配置引用
// 用法：node scripts/reachability-audit.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const SRC = join(ROOT, 'src')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(ts|vue)$/.test(name) && !name.endsWith('.d.ts')) out.push(p)
  }
  return out
}

const allFiles = walk(SRC)
const fileSet = new Set(allFiles)
const rel = (f) => f.replace(`${ROOT}/`, '')

const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g

function resolveImport(spec, fromFile) {
  let base
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec)
  else return null
  const candidates = [base, `${base}.ts`, `${base}.vue`, `${base}.js`, join(base, 'index.ts'), join(base, 'index.vue')]
  for (const c of candidates) if (fileSet.has(c)) return c
  return null
}

const deps = new Map(allFiles.map((f) => [f, []]))
const refs = new Map(allFiles.map((f) => [f, []]))
for (const file of allFiles) {
  const code = readFileSync(file, 'utf8')
  let m
  IMPORT_RE.lastIndex = 0
  while ((m = IMPORT_RE.exec(code)) !== null) {
    const spec = m[1] || m[2] || m[3]
    if (!spec || /\.(scss|css)$/.test(spec)) continue
    const dep = resolveImport(spec, file)
    if (!dep) continue
    deps.get(file).push(dep)
    refs.get(dep).push(file)
  }
}

// 生产入口闭包：app.vue + main.ts
const prodSeen = new Set()
const prodQueue = [join(SRC, 'app.vue'), join(SRC, 'main.ts')]
while (prodQueue.length) {
  const file = prodQueue.pop()
  if (prodSeen.has(file)) continue
  prodSeen.add(file)
  for (const dep of deps.get(file) || []) if (!prodSeen.has(dep)) prodQueue.push(dep)
}

// 测试入口闭包：所有 *.test.ts + test-setup.ts + test-utils
const testSeen = new Set()
const testQueue = [
  ...allFiles.filter((f) => f.endsWith('.test.ts')),
  join(SRC, 'test-setup.ts'),
]
while (testQueue.length) {
  const file = testQueue.pop()
  if (testSeen.has(file)) continue
  testSeen.add(file)
  for (const dep of deps.get(file) || []) if (!testSeen.has(dep)) testQueue.push(dep)
}

const seen = prodSeen

const CONFIG_FILES = ['vitest.config.ts', 'vite.config.mts', 'tsconfig.json', 'tsconfig.node.json', 'package.json', 'index.html', 'eslint.config.js']
const configText = CONFIG_FILES.map((f) => {
  try { return readFileSync(join(ROOT, f), 'utf8') } catch { return '' }
}).join('\n')

const unreachable = allFiles.filter((f) => !prodSeen.has(f))
const categories = { pureDead: [], testedOrphan: [], configOnly: [] }

for (const f of unreachable) {
  const inTest = testSeen.has(f)
  const isTestFile = f.endsWith('.test.ts')
  if (inTest || isTestFile) categories.configOnly.push(f)
  else categories.pureDead.push(f)
}

console.log(`生产可达: ${prodSeen.size} | 测试可达: ${testSeen.size} | 源文件总数: ${allFiles.length}`)
console.log(`\n=== A. 完全不可达（生产与测试都不引用）→ 可删除: ${categories.pureDead.length} ===`)
for (const f of categories.pureDead) console.log(' ', rel(f))
console.log(`\n=== B. 仅测试可达（有测试覆盖但未接入产品）→ 需决策: ${categories.configOnly.length} ===`)
for (const f of categories.configOnly) console.log(' ', rel(f))
