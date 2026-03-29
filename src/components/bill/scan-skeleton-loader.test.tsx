import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScanSkeletonLoader } from "./scan-skeleton-loader";

describe("ScanSkeletonLoader", () => {
  it("renders the processing heading", () => {
    render(<ScanSkeletonLoader />);
    expect(screen.getByText("Processando nota...")).toBeInTheDocument();
  });

  it("renders the progress indicator text", () => {
    render(<ScanSkeletonLoader />);
    expect(screen.getByText("Analisando imagem...")).toBeInTheDocument();
  });

  it("renders 5 skeleton item cards", () => {
    const { container } = render(<ScanSkeletonLoader />);
    // Each skeleton item is a rounded-2xl border bg-card card inside the stagger container
    // The stagger container has class "space-y-2", and contains 5 child divs
    // We count animate-pulse elements that represent item description skeletons (w-3/4)
    const descriptionSkeletons = container.querySelectorAll(".w-3\\/4");
    expect(descriptionSkeletons).toHaveLength(5);
  });

  it("renders merchant skeleton section", () => {
    render(<ScanSkeletonLoader />);
    // The description text under the heading
    expect(
      screen.getByText("Lendo itens da nota fiscal. Isso pode levar alguns segundos."),
    ).toBeInTheDocument();
  });
});
