// Shown while the (force-dynamic) project page runs its Supabase queries, so
// navigation shows a skeleton instead of a blank wait.
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <div className="animate-pulse space-y-6">
        <div className="h-6 w-1/3 rounded bg-neutral-200 dark:bg-neutral-800" />
        <div className="h-24 rounded-xl bg-neutral-100 dark:bg-neutral-900" />
        <div className="h-24 rounded-xl bg-neutral-100 dark:bg-neutral-900" />
        <div className="h-40 rounded-xl bg-neutral-100 dark:bg-neutral-900" />
      </div>
    </main>
  )
}
