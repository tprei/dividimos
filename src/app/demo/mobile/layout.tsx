import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Prévia mobile",
  robots: {
    index: false,
    follow: false,
  },
};

export default function MobilePreviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
