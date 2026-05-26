/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Confetti celebration effect for level completion.
 */

// ========== CONFETTI EFFECT ==========

const confettiColors = [
  '#ff6b6b', // red
  '#ffd93d', // yellow
  '#6bcb77', // green
  '#4d96ff', // blue
  '#ff8cc8', // pink
  '#a855f7', // purple
  '#f97316', // orange
];

const confettiShapes = ['circle', 'square', 'ribbon'];
const confettiSwings = ['', 'swing-left', 'swing-right'];

let cleanupTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Launch confetti particles for level completion celebration.
 */
export function launchConfetti() {
  const container = document.getElementById('confettiContainer');
  if (!container) return;

  // Cancel any pending cleanup from a previous launch, then clear existing particles
  if (cleanupTimer !== null) {
    clearTimeout(cleanupTimer);
    cleanupTimer = null;
  }
  container.innerHTML = '';

  // Create 80 confetti particles
  const particleCount = 80;

  for (let i = 0; i < particleCount; i++) {
    const confetti = document.createElement('div');
    confetti.className = 'confetti';

    // Random shape
    const shape = confettiShapes[Math.floor(Math.random() * confettiShapes.length)];
    confetti.classList.add(shape);

    // Random swing pattern
    const swing = confettiSwings[Math.floor(Math.random() * confettiSwings.length)];
    if (swing) confetti.classList.add(swing);

    // Random color
    const color = confettiColors[Math.floor(Math.random() * confettiColors.length)];
    confetti.style.backgroundColor = color;

    // Random horizontal position (spread across the screen)
    confetti.style.left = `${Math.random() * 100}%`;

    // Start from top with some variation
    confetti.style.top = `${-10 + Math.random() * 20}px`;

    // Random size variation
    const size = 4 + Math.random() * 5;
    if (shape !== 'ribbon') {
      confetti.style.width = `${size}px`;
      confetti.style.height = `${size}px`;
    } else {
      confetti.style.width = `${size * 0.5}px`;
      confetti.style.height = `${size * 1.5}px`;
    }

    // Random animation duration (2-4 seconds)
    const duration = 2 + Math.random() * 2;
    confetti.style.animationDuration = `${duration}s`;

    // Stagger the start of each confetti
    confetti.style.animationDelay = `${Math.random() * 0.5}s`;

    container.appendChild(confetti);
  }

  // Clean up confetti after animation completes
  cleanupTimer = setTimeout(() => {
    container.innerHTML = '';
    cleanupTimer = null;
  }, 4500);
}
