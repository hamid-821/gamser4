/** با بالا آمدن Next، سرور بازی (appg/server.cjs) را به‌عنوان پردازش فرزند روی پورت 3001 اجرا می‌کند. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startGameServer } = await import("./lib/game-server");
  await startGameServer();
}
