import { test, expect } from "../fixtures";

test("same-name members remain distinct across balances and graph", async ({ page, seed, loginAs }) => {
  const [viewer, silva, almeida] = await Promise.all([
    seed.createUser({ name: "Ana" }),
    seed.createUser({ name: "João Silva" }),
    seed.createUser({ name: "João Almeida" }),
  ]);
  const group = await seed.createGroup(viewer.id, [silva.id, almeida.id], "Joãos no almoço");
  await seed.createExpense(group.id, viewer.id, [viewer.id, silva.id, almeida.id], {
    totalCents: 9000,
    shares: [3000, 3000, 3000],
  });
  await loginAs(viewer, { navigate: false });
  await page.goto(`/app/groups/${group.id}`);
  await page.getByRole("radio", { name: "Saldos", exact: true }).check();

  const card = page.getByRole("region", { name: "Saldos", exact: true });
  await expect(card.getByText(/^João S\./)).toBeVisible();
  await expect(card.getByText(/^João A\./)).toBeVisible();
  await expect(card.getByText(/^Você /)).toBeVisible();
  await page.getByText("Como os pagamentos se simplificam").click();
  const graph = page.getByRole("group", { name: "Grafo de dívidas" });
  await expect(graph.getByText("João S.", { exact: true })).toBeVisible();
  await expect(graph.getByText("João A.", { exact: true })).toBeVisible();
  await expect(graph.getByText("Você", { exact: true })).toBeVisible();
  const transfers = page.getByRole("region", { name: "Quem paga quem", exact: true });
  await expect(transfers.getByText("João S.", { exact: true })).toBeVisible();
  await expect(transfers.getByText("João A.", { exact: true })).toBeVisible();
  await expect(card.getByText("João", { exact: true })).toHaveCount(0);
  await expect(graph.getByText("João", { exact: true })).toHaveCount(0);
});