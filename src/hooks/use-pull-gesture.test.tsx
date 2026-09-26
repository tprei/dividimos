import { createElement } from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { haptics } from "@/hooks/use-haptics";
import { PULL_IGNORE_CONTROLS, PULL_IGNORE_FIELDS, usePullGesture } from "./use-pull-gesture";

vi.mock("@/hooks/use-haptics", () => ({
  haptics: { impact: vi.fn(), selectionChanged: vi.fn() },
}));

interface HostProps {
  ignore: string;
  onPull: () => void;
}

function PullHost({ ignore, onPull }: HostProps) {
  const { handlers } = usePullGesture({ enabled: true, ignore, onPull });
  return createElement(
    "div",
    { ...handlers },
    createElement("button", { type: "button" }, "salvar"),
  );
}

function ScrolledPullHost({ ignore, onPull }: HostProps) {
  const { handlers } = usePullGesture({ enabled: true, ignore, onPull });
  return createElement(
    "div",
    { style: { overflowY: "auto" } },
    createElement("div", { ...handlers }),
  );
}

const pullDown = async (target: HTMLElement) => {
  act(() => {
    fireEvent.touchStart(target, { touches: [{ clientX: 0, clientY: 0 }] });
  });
  act(() => {
    fireEvent.touchMove(target, { touches: [{ clientX: 0, clientY: 300 }] });
  });
  await act(async () => {
    fireEvent.touchEnd(target);
  });
};

describe("usePullGesture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fires when the pull starts on a button under the fields-only ignore list", async () => {
    const onPull = vi.fn();
    const { container } = render(createElement(PullHost, { ignore: PULL_IGNORE_FIELDS, onPull }));
    const button = container.querySelector("button")!;

    await pullDown(button);

    expect(haptics.selectionChanged).toHaveBeenCalledOnce();
    expect(haptics.impact).toHaveBeenCalledOnce();
    expect(onPull).toHaveBeenCalledOnce();
  });

  it("ignores a pull that starts on a button under the controls ignore list", async () => {
    const onPull = vi.fn();
    const { container } = render(createElement(PullHost, { ignore: PULL_IGNORE_CONTROLS, onPull }));
    const button = container.querySelector("button")!;

    await pullDown(button);

    expect(haptics.selectionChanged).not.toHaveBeenCalled();
    expect(haptics.impact).not.toHaveBeenCalled();
    expect(onPull).not.toHaveBeenCalled();
  });

  it("reads the scrollTop of the nearest scrolling ancestor, not the bound element", async () => {
    let now = 10_000;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    const onPull = vi.fn();
    const { container } = render(createElement(ScrolledPullHost, { ignore: PULL_IGNORE_FIELDS, onPull }));
    const scroller = container.firstElementChild as HTMLElement;
    const host = scroller.firstElementChild as HTMLElement;

    scroller.scrollTop = 40;
    now += 1_000;
    await pullDown(host);
    expect(onPull).not.toHaveBeenCalled();

    scroller.scrollTop = 0;
    now += 1_000;
    await pullDown(host);
    expect(onPull).toHaveBeenCalledOnce();

    clock.mockRestore();
  });
});
