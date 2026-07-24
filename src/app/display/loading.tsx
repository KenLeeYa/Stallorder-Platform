export default function PickupDisplayRouteLoading() {
  return (
    <main className="min-h-screen bg-stone-50 px-4 py-6" aria-busy="true">
      <div className="mx-auto max-w-[1600px] animate-pulse">
        <div className="h-16 w-72 rounded-md bg-stone-200" />
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          {[0, 1].map((column) => <div key={column} className="h-80 border-y border-stone-200 bg-white" />)}
        </div>
      </div>
    </main>
  );
}
