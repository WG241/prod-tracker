import { Database, Rocket } from 'lucide-react'

function App() {
  return (
    <main className="min-h-svh flex flex-col items-center justify-center gap-4 bg-zinc-50 text-zinc-900 p-6">
      <div className="flex items-center gap-3">
        <Rocket className="size-8 text-sky-600" />
        <h1 className="text-3xl font-semibold tracking-tight">prod-tracker</h1>
      </div>
      <p className="text-zinc-600 flex items-center gap-2">
        <Database className="size-4" />
        React + Vite · Tailwind v4 · Lucide · Neon + Prisma
      </p>
    </main>
  )
}

export default App
