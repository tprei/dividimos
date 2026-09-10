import { test, expect } from "../fixtures";

test.describe("Settlement plan graph", () => {
  test("collapses the raw debts into the simplified plan and replays on demand", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Grafo" });
    const bruno = await seed.createUser({ name: "Bruno Grafo" });
    const carla = await seed.createUser({ name: "Carla Grafo" });
    const group = await seed.createGroup(alice.id, [bruno.id, carla.id], "Grupo Grafo");

    await seed.createExpense(group.id, bruno.id, [alice.id, bruno.id], {
      title: "Alice deve a Bruno",
      totalCents: 10000,
      expenseType: "single_amount",
    });
    await seed.createExpense(group.id, carla.id, [bruno.id, carla.id], {
      title: "Bruno deve a Carla",
      totalCents: 10000,
      expenseType: "single_amount",
    });
    await seed.createExpense(group.id, carla.id, [alice.id, carla.id], {
      title: "Alice deve a Carla",
      totalCents: 2000,
      expenseType: "single_amount",
    });

    await loginAs(alice, { navigate: false });
    await page.goto(`/app/groups/${group.id}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("tab", { name: "Saldos" }).click();

    const plan = page.getByRole("region", { name: "Plano sugerido" });
    await expect(plan).toContainText("Simplificação · 3 → 1");

    const edges = plan.locator('svg[role="group"] foreignObject');
    await expect(edges).toHaveCount(1, { timeout: 15000 });
    await expect(plan.getByRole("button", { name: /Alice.*R\$\s*60,00.*Carla/ })).toBeVisible();

    const nodesAt = () =>
      plan.locator('svg[role="group"] circle').evaluateAll((circles) =>
        circles.map((c) => `${c.getAttribute("cx")},${c.getAttribute("cy")}`),
      );
    const simplifiedNodes = await nodesAt();
    expect(simplifiedNodes).toHaveLength(3);

    await plan.getByRole("button", { name: "Ver dívidas originais" }).click();
    await expect(edges).toHaveCount(3);
    expect(await nodesAt()).toEqual(simplifiedNodes);

    await plan.getByRole("button", { name: "Ver plano simplificado" }).click();
    await expect(edges).toHaveCount(1, { timeout: 15000 });
    expect(await nodesAt()).toEqual(simplifiedNodes);
  });

  test("keeps consolidated balance avatars from overlapping", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Saldo" });
    const others = [];
    for (const name of ["Bruno Saldo", "Carla Saldo", "Duda Saldo", "Elis Saldo"]) {
      others.push(await seed.createUser({ name }));
    }
    const group = await seed.createGroup(
      alice.id,
      others.map((user) => user.id),
      "Grupo Saldo",
    );

    await seed.createExpense(group.id, alice.id, [alice.id, others[0].id], {
      title: "Fatia grande",
      totalCents: 18000,
      expenseType: "single_amount",
    });
    for (const other of others.slice(1)) {
      await seed.createExpense(group.id, alice.id, [alice.id, other.id], {
        title: `Fatia mínima de ${other.name}`,
        totalCents: 100,
        expenseType: "single_amount",
      });
    }

    await loginAs(alice, { navigate: false });
    await page.goto(`/app/groups/${group.id}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("tab", { name: "Saldos" }).click();

    const card = page.getByRole("region", { name: "Saldo consolidado" });
    await expect(card).toBeVisible();

    const boxes = await card
      .locator("span.absolute")
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const r = node.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        }),
      );
    expect(boxes.length).toBeGreaterThan(2);

    const overlaps = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const intersects =
          a.left < b.right - 0.5 &&
          b.left < a.right - 0.5 &&
          a.top < b.bottom - 0.5 &&
          b.top < a.bottom - 0.5;
        if (intersects) overlaps.push([i, j]);
      }
    }
    expect(overlaps).toEqual([]);

    const cardBox = (await card.boundingBox())!;
    for (const box of boxes) {
      expect(box.left).toBeGreaterThanOrEqual(cardBox.x - 0.5);
      expect(box.right).toBeLessThanOrEqual(cardBox.x + cardBox.width + 0.5);
    }
  });
});
