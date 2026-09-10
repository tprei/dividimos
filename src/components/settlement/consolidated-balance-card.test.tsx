import { describe, expect, it } from "vitest";
import { fanLayout } from "./consolidated-balance-card";
import type { FanPlacement } from "./consolidated-balance-card";

const DIAMETER = 24;
const GAP = 4;

function expectSeparation(placements: FanPlacement[], laneWidth: number): void {
  const indexes = placements.map((placement) => placement.index);
  expect([...indexes].sort((a, b) => a - b)).toEqual(
    placements.map((_, index) => index),
  );
  for (const placement of placements) {
    expect(placement.x).toBeGreaterThanOrEqual(DIAMETER / 2);
    expect(placement.x).toBeLessThanOrEqual(
      Math.max(DIAMETER / 2, laneWidth - DIAMETER / 2),
    );
  }
  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      if (placements[i]!.row === placements[j]!.row) {
        expect(
          Math.abs(placements[i]!.x - placements[j]!.x),
        ).toBeGreaterThanOrEqual(DIAMETER + GAP);
      }
    }
  }
}


describe("fanLayout", () => {
  it("keeps two well separated avatars untouched on one row", () => {
    const placements = fanLayout({
      centers: [25, 75],
      laneWidth: 169,
      diameter: DIAMETER,
      gap: GAP,
    });

    expect(placements.map((placement) => placement.row)).toEqual([0, 0]);
    expect(placements.map((placement) => placement.x)).toEqual([25, 75]);
    expectSeparation(placements, 169);
  });

  it("separates avatars pinned together by the edge clamp", () => {
    const placements = fanLayout({
      centers: [0.5, 1, 50, 99.5],
      laneWidth: 169,
      diameter: DIAMETER,
      gap: GAP,
    });

    expectSeparation(placements, 169);
    const [first, second] = placements;
    expect(first!.x).toBe(12);
    expect(second!.x).toBeGreaterThanOrEqual(first!.x + DIAMETER + GAP);
  });

  it("fans six crowded avatars onto a second row in a narrow lane", () => {
    const placements = fanLayout({
      centers: [4, 8, 12, 18, 22, 95],
      laneWidth: 120,
      diameter: DIAMETER,
      gap: GAP,
    });

    expect(placements).toHaveLength(6);
    expect(Math.max(...placements.map((placement) => placement.row))).toBe(1);
    expectSeparation(placements, 120);
  });

  it("keeps a sub-2% share avatar inside bounds and clear of neighbors", () => {
    const placements = fanLayout({
      centers: [1.9, 3.4, 48, 52, 55, 90],
      laneWidth: 169,
      diameter: DIAMETER,
      gap: GAP,
    });

    expectSeparation(placements, 169);
    const smallest = placements.find((placement) => placement.index === 0);
    expect(smallest!.x).toBe(12);
  });

  it("lifts the third identical center onto its own row", () => {
    const placements = fanLayout({
      centers: [50, 50, 50],
      laneWidth: 100,
      diameter: DIAMETER,
      gap: GAP,
    });

    expect(placements.map((placement) => placement.x)).toEqual([50, 78, 50]);
    expect(placements.map((placement) => placement.row)).toEqual([0, 0, 1]);
    expectSeparation(placements, 100);
  });

  it("returns stable output for equal inputs", () => {
    const input = {
      centers: [10, 40, 41, 42],
      laneWidth: 90,
      diameter: DIAMETER,
      gap: GAP,
    };
    const first = fanLayout(input);
    const second = fanLayout(input);

    expect(first).toEqual(second);
    expectSeparation(first, input.laneWidth);
  });
});
