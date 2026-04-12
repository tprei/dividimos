"use client";

import { motion } from "framer-motion";
import { useState } from "react";

const COLORS = ["#22c55e", "#3b82f6", "#eab308", "#f97316", "#a855f7", "#ec4899"];
const PARTICLE_COUNT = 30;

interface Particle {
  id: number;
  color: string;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  shape: "circle" | "rect";
}

function generateParticles(): Particle[] {
  const particles: Particle[] = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const angle = (i / PARTICLE_COUNT) * Math.PI * 2;
    const radius = 80 + (i * 37) % 100;
    particles.push({
      id: i,
      color: COLORS[i % COLORS.length],
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius - 60,
      rotation: (i * 73) % 360 - 180,
      scale: 0.5 + (i % 3) * 0.25,
      shape: i % 2 === 0 ? "circle" : "rect",
    });
  }
  return particles;
}

const PARTICLES = generateParticles();

export function ConfettiBurst() {
  const [particles] = useState(PARTICLES);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          initial={{ x: 0, y: 0, opacity: 1, scale: 0, rotate: 0 }}
          animate={{
            x: p.x,
            y: p.y,
            opacity: [1, 1, 0],
            scale: p.scale,
            rotate: p.rotation,
          }}
          transition={{
            duration: 1.2,
            ease: [0.22, 0.61, 0.36, 1],
            opacity: { times: [0, 0.7, 1] },
          }}
          className="absolute left-1/2 top-1/2"
          style={{
            width: p.shape === "circle" ? 8 : 10,
            height: p.shape === "circle" ? 8 : 6,
            borderRadius: p.shape === "circle" ? "50%" : 2,
            backgroundColor: p.color,
          }}
        />
      ))}
    </div>
  );
}
