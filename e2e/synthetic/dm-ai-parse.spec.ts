import { test, expect } from "../fixtures";

const MOCK_PARSE_RESULT = {
  title: "Uber",
  amountCents: 2500,
  expenseType: "single_amount",
  splitType: "equal",
  items: [],
  participants: [],
  payerHandle: "SELF",
  merchantName: "Uber",
  confidence: "high",
};

test.describe("DM AI parse", () => {
  test("sparkle toggle visually activates AI mode", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice AI" });
    const bob = await seed.createUser({ name: "Bob AI" });
    const dm = await seed.createDmGroup(alice, bob);

    await loginAs(alice);
    await page.goto(`/app/conversations/${bob.id}`);
    await page.waitForLoadState("networkidle");

    const sparkle = page.getByTestId("sparkle-toggle");
    await expect(sparkle).toBeVisible();

    // Before toggle: aria-pressed should be false
    await expect(sparkle).toHaveAttribute("aria-pressed", "false");

    // Input has normal placeholder before toggle
    const input = page.getByTestId("chat-input");
    await expect(input).toHaveAttribute("placeholder", "Mensagem…");

    await sparkle.click();

    // After toggle: aria-pressed is true, placeholder changes
    await expect(sparkle).toHaveAttribute("aria-pressed", "true");
    await expect(input).toHaveAttribute(
      "placeholder",
      "Descreva a despesa (ex: 'uber 25 eu paguei')",
    );

    void dm;
  });

  test("submitting in AI mode with a mocked parse shows the draft card", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Draft AI" });
    const bob = await seed.createUser({ name: "Bob Draft AI" });
    const dm = await seed.createDmGroup(alice, bob);

    await page.route("**/api/chat/parse", async (route) => {
      await route.fulfill({ json: MOCK_PARSE_RESULT });
    });

    await loginAs(alice);
    await page.goto(`/app/conversations/${bob.id}`);
    await page.waitForLoadState("networkidle");

    await page.getByTestId("sparkle-toggle").click();
    await page.getByTestId("chat-input").fill("uber 25 eu paguei");
    await page.keyboard.press("Enter");

    // Loading skeleton appears briefly
    // Wait for draft card to appear
    const draftCard = page.getByTestId("chat-draft-card");
    await expect(draftCard).toBeVisible({ timeout: 5000 });

    await expect(page.getByTestId("draft-title")).toHaveText("Uber");
    await expect(page.getByTestId("draft-amount")).toHaveText("R$ 25,00");

    // Both action buttons must be visible
    await expect(page.getByTestId("draft-edit-button")).toBeVisible();
    await expect(page.getByTestId("draft-confirm-button")).toBeVisible();

    void dm;
  });

  test("the Edit button navigates to the wizard with prefilled parameters", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Edit AI" });
    const bob = await seed.createUser({ name: "Bob Edit AI" });
    const dm = await seed.createDmGroup(alice, bob);

    await page.route("**/api/chat/parse", async (route) => {
      await route.fulfill({ json: MOCK_PARSE_RESULT });
    });

    await loginAs(alice);
    await page.goto(`/app/conversations/${bob.id}`);
    await page.waitForLoadState("networkidle");

    await page.getByTestId("sparkle-toggle").click();
    await page.getByTestId("chat-input").fill("uber 25 eu paguei");
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("chat-draft-card")).toBeVisible({
      timeout: 5000,
    });

    await page.getByTestId("draft-edit-button").click();

    await expect(page).toHaveURL(/\/app\/bill\/new.*groupId=/, { timeout: 5000 });
    const url = new URL(page.url());
    expect(url.searchParams.get("groupId")).toBe(dm.id);
    expect(url.searchParams.get("title")).toBe("Uber");
    expect(url.searchParams.get("amount")).toBe("2500");
  });

  test("the Confirm button creates the expense via confirmChatDraft", async ({
    page,
    seed,
    loginAs,
    adminClient,
  }) => {
    const alice = await seed.createUser({ name: "Alice Confirm AI" });
    const bob = await seed.createUser({ name: "Bob Confirm AI" });
    const dm = await seed.createDmGroup(alice, bob);

    await page.route("**/api/chat/parse", async (route) => {
      await route.fulfill({ json: MOCK_PARSE_RESULT });
    });

    await loginAs(alice);
    await page.goto(`/app/conversations/${bob.id}`);
    await page.waitForLoadState("networkidle");

    await page.getByTestId("sparkle-toggle").click();
    await page.getByTestId("chat-input").fill("uber 25 eu paguei");
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("chat-draft-card")).toBeVisible({
      timeout: 5000,
    });

    await page.getByTestId("draft-confirm-button").click();

    // Draft card disappears after confirmation
    await expect(page.getByTestId("chat-draft-card")).not.toBeVisible({
      timeout: 8000,
    });

    // Verify the expense was created; the header lives on the current version
    const { data: expenses } = await adminClient
      .from("expenses")
      .select("id, current_version_no")
      .eq("group_id", dm.id)
      .eq("status", "active");

    expect(expenses).toHaveLength(1);
    const expenseId = expenses![0].id as string;

    const { data: versions } = await adminClient
      .from("expense_versions")
      .select("title, total_cents")
      .eq("expense_id", expenseId)
      .eq("version_no", expenses![0].current_version_no as number);

    expect(versions).toHaveLength(1);
    expect(versions![0].title).toBe("Uber");
    expect(versions![0].total_cents).toBe(2500);

    const { data: events } = await adminClient
      .from("group_events")
      .select("id")
      .eq("group_id", dm.id)
      .eq("kind", "expense_created")
      .eq("expense_id", expenseId);

    expect(events).toHaveLength(1);
  });

  test("the Escape key leaves AI mode and clears the text", async ({
    page,
    seed,
    loginAs,
  }) => {
    const alice = await seed.createUser({ name: "Alice Escape AI" });
    const bob = await seed.createUser({ name: "Bob Escape AI" });
    const dm = await seed.createDmGroup(alice, bob);

    await loginAs(alice);
    await page.goto(`/app/conversations/${bob.id}`);
    await page.waitForLoadState("networkidle");

    const sparkle = page.getByTestId("sparkle-toggle");
    const input = page.getByTestId("chat-input");

    await sparkle.click();
    await expect(sparkle).toHaveAttribute("aria-pressed", "true");

    await input.fill("texto qualquer");
    await expect(input).toHaveValue("texto qualquer");

    await input.press("Escape");

    // Mode returns to normal: aria-pressed false, placeholder back to default
    await expect(sparkle).toHaveAttribute("aria-pressed", "false");
    await expect(input).toHaveAttribute("placeholder", "Mensagem…");
    await expect(input).toHaveValue("");

    void dm;
  });
});
