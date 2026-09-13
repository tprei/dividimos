import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserProfile } from "@/types/ledger";
import { lookupUserByHandle } from "@/lib/sync/mutations-group";
import { AddParticipantByHandle } from "./add-participant-by-handle";

vi.mock("@/lib/sync/mutations-group", () => ({
  lookupUserByHandle: vi.fn(),
}));

const lookup = vi.mocked(lookupUserByHandle);

function profile(handle: string): UserProfile {
  return {
    id: `user-${handle}`,
    handle,
    name: handle[0].toUpperCase() + handle.slice(1),
    avatarUrl: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderSearch(overrides: { onAdd?: () => void; excludeIds?: string[] } = {}) {
  return render(
    <AddParticipantByHandle
      onAdd={overrides.onAdd ?? vi.fn()}
      onCancel={vi.fn()}
      excludeIds={overrides.excludeIds ?? []}
    />,
  );
}

function searchButton(): HTMLElement {
  return screen.getByRole("button", { name: "Buscar handle" });
}

function typeHandle(value: string): void {
  fireEvent.change(screen.getByPlaceholderText(/handle/), { target: { value } });
}

function pressEnter(): void {
  fireEvent.keyDown(screen.getByPlaceholderText(/handle/), { key: "Enter" });
}

beforeEach(() => {
  lookup.mockReset();
});

describe("AddParticipantByHandle", () => {
  it("renders handle input with @ prefix", () => {
    renderSearch();
    expect(screen.getByText("@")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/handle/)).toBeInTheDocument();
  });

  it("replaces spaces with periods in handle input", async () => {
    renderSearch();
    // The animated container replaces the input node on re-render, so it is
    // re-queried rather than captured.
    typeHandle("joao silva");
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/handle/)).toHaveValue("joao.silva");
    });
  });

  it("reports a user who does not exist", async () => {
    lookup.mockResolvedValue(null);
    renderSearch();

    typeHandle("ninguem");
    await userEvent.click(searchButton());

    expect(await screen.findByText(/Nenhum usuario encontrado com @ninguem/)).toBeInTheDocument();
  });

  it("shows a retryable failure instead of claiming nobody was found", async () => {
    lookup.mockRejectedValueOnce(new Error("offline"));
    renderSearch();

    typeHandle("alice");
    await userEvent.click(searchButton());

    expect(await screen.findByText("Não foi possível buscar @alice.")).toBeInTheDocument();
    expect(screen.queryByText(/Nenhum usuario encontrado/)).not.toBeInTheDocument();

    lookup.mockResolvedValueOnce(profile("alice"));
    await userEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));

    expect(await screen.findByText("@alice")).toBeInTheDocument();
  });

  it("ignores a stale result that arrives after the handle changed", async () => {
    const aliceLookup = deferred<UserProfile | null>();
    lookup.mockReturnValueOnce(aliceLookup.promise);
    lookup.mockResolvedValueOnce(profile("bob"));

    const onAdd = vi.fn();
    renderSearch({ onAdd });

    typeHandle("alice");
    await userEvent.click(searchButton());

    // The user changes their mind and searches for somebody else.
    typeHandle("bob");
    await userEvent.click(searchButton());
    expect(await screen.findByText("@bob")).toBeInTheDocument();

    // Alice's lookup lands late and must not replace Bob.
    aliceLookup.resolve(profile("alice"));
    await waitFor(() => expect(screen.getByText("@bob")).toBeInTheDocument());
    expect(screen.queryByText("@alice")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ handle: "bob" }));
  });

  it("does not start a second search from Enter while one is in flight", async () => {
    const pending = deferred<UserProfile | null>();
    lookup.mockReturnValue(pending.promise);
    renderSearch();

    typeHandle("alice");
    pressEnter();
    await waitFor(() => expect(lookup).toHaveBeenCalledTimes(1));

    pressEnter();
    pressEnter();
    expect(lookup).toHaveBeenCalledTimes(1);

    pending.resolve(profile("alice"));
    expect(await screen.findByText("@alice")).toBeInTheDocument();
  });
});
