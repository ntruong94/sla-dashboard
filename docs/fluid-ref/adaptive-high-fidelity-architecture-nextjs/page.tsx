"use client"

import { useEffect } from "react"
import Script from "next/script"
import { Icon } from "@iconify/react"

export default function Page() {
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const x = (e.clientX / window.innerWidth) * 100
      const y = (e.clientY / window.innerHeight) * 100

      document.documentElement.style.setProperty("--mouse-x", `${x}%`)
      document.documentElement.style.setProperty("--mouse-y", `${y}%`)

      const cards = document.querySelectorAll(".bento-card, .btn-mercury")

      cards.forEach((card) => {
        const rect = card.getBoundingClientRect()
        const cardX = ((e.clientX - rect.left) / rect.width) * 100
        const cardY = ((e.clientY - rect.top) / rect.height) * 100

        ;(card as HTMLElement).style.setProperty("--mouse-x", `${cardX}%`)
        ;(card as HTMLElement).style.setProperty("--mouse-y", `${cardY}%`)
      })
    }

    const handleScroll = () => {
      document.documentElement.style.setProperty(
        "--scroll-pos",
        `${window.scrollY}`
      )
    }

    document.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("scroll", handleScroll)

    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            ;(entry.target as HTMLElement).style.opacity = "1"
          }
        })
      },
      { threshold: 0.1 }
    )

    document
      .querySelectorAll(".scroll-reveal")
      .forEach((el) => revealObserver.observe(el))

    return () => {
      document.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("scroll", handleScroll)
      revealObserver.disconnect()
    }
  }, [])

  return (
    <>
      <Script
        src="https://code.iconify.design/Icon/1.0.7/Icon.min.js"
        strategy="beforeInteractive"
      />

      <style jsx global>{`
        :root {
          --mouse-x: 50%;
          --mouse-y: 50%;
          --scroll-pos: 0;
          --bg: oklch(10% 0.01 250);
        }

        body {
          background: var(--bg);
          color: white;
          overflow-x: hidden;
          -webkit-font-smoothing: antialiased;
          font-family: Inter, system-ui, sans-serif;
        }

        .kinetic-title {
          letter-spacing: -0.06em;
          line-height: 0.82;
          background: linear-gradient(
            to right,
            oklch(100% 0 0) 20%,
            oklch(85% 0.16 95) 40%,
            oklch(85% 0.16 95) 60%,
            oklch(100% 0 0) 80%
          );
          background-size: 200% auto;
          -webkit-background-clip: text;
          color: transparent;
          animation: textShimmer 8s linear infinite;
        }

        @keyframes textShimmer {
          to {
            background-position: 200% center;
          }
        }

        .video-portal {
          mask-image: radial-gradient(
            circle at var(--mouse-x) var(--mouse-y),
            black 30%,
            transparent 75%
          );
          -webkit-mask-image: radial-gradient(
            circle at var(--mouse-x) var(--mouse-y),
            black 30%,
            transparent 75%
          );
          transition: mask-image 0.2s ease-out;
          filter: saturate(1.2) contrast(1.1);
        }

        .glass-layer-1 {
          backdrop-filter: blur(10px);
          background: oklch(100% 0 0 / 0.03);
        }

        .glass-layer-2 {
          backdrop-filter: blur(40px) saturate(180%);
          background: oklch(100% 0 0 / 0.05);
        }

        .btn-mercury {
          position: relative;
          background: oklch(20% 0.01 250);
          overflow: hidden;
          transition: all 0.6s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .btn-mercury::before {
          content: "";
          position: absolute;
          inset: 0;
          background: radial-gradient(
            circle at var(--mouse-x) var(--mouse-y),
            oklch(85% 0.16 95 / 0.4),
            transparent 70%
          );
          opacity: 0;
          transition: opacity 0.4s;
        }

        .btn-mercury:hover::before {
          opacity: 1;
        }

        .btn-mercury:hover {
          transform: translateY(-2px);
          border-color: oklch(85% 0.16 95 / 0.5);
        }

        .bento-card {
          background: linear-gradient(
            135deg,
            oklch(20% 0.02 250),
            oklch(15% 0.01 250)
          );
          border: 1px solid oklch(100% 0 0 / 0.08);
          position: relative;
        }

        .bento-card::after {
          content: "";
          position: absolute;
          inset: -1px;
          background: radial-gradient(
            600px circle at var(--mouse-x) var(--mouse-y),
            oklch(85% 0.16 95 / 0.25),
            transparent 40%
          );
          z-index: 1;
          opacity: 0;
          transition: opacity 0.5s;
          pointer-events: none;
          border-radius: inherit;
        }

        .bento-card:hover::after {
          opacity: 1;
        }

        .scroll-reveal {
          view-timeline-name: --reveal;
          view-timeline-axis: block;
          animation-timeline: --reveal;
          animation-name: revealAnim;
          animation-range: entry 10% cover 30%;
          animation-fill-mode: both;
        }

        @keyframes revealAnim {
          from {
            opacity: 0;
            transform: translateY(100px) scale(0.95);
            filter: blur(20px);
          }

          to {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: blur(0);
          }
        }

        .mask-edge-soften {
          mask-image: linear-gradient(
            to right,
            transparent,
            black 15%,
            black 85%,
            transparent
          );
        }
      `}</style>

      <main className="bg-[oklch(10%_0.01_250)] text-white antialiased selection:bg-yellow-300/30 selection:text-yellow-300">
        <nav className="fixed top-0 z-[100] flex w-full items-center justify-between px-6 py-8 mix-blend-difference">
          <div className="flex items-center gap-3">
            <div className="glass-layer-1 flex h-10 w-10 items-center justify-center rounded-full border border-yellow-300/30">
              <div className="h-2 w-2 animate-pulse rounded-full bg-yellow-300"></div>
            </div>

            <span className="text-sm font-bold uppercase tracking-[0.2em]">
              Lumina
            </span>
          </div>

          <div className="glass-layer-2 hidden items-center gap-8 rounded-full border border-white/10 px-6 py-2 text-[11px] font-bold uppercase tracking-widest md:flex">
            <a href="#" className="transition-colors hover:text-yellow-300">
              Manifesto
            </a>

            <a href="#" className="transition-colors hover:text-yellow-300">
              Architecture
            </a>

            <a href="#" className="transition-colors hover:text-yellow-300">
              Contact
            </a>
          </div>

          <button className="btn-mercury rounded-full border border-white/10 px-6 py-2 text-[11px] font-bold uppercase tracking-widest">
            Inquire
          </button>
        </nav>

        <section
          id="hero"
          className="relative flex h-screen w-full items-center justify-center overflow-hidden px-6"
        >
          <div className="video-portal absolute inset-0 z-0 scale-110 opacity-50">
            <video
              autoPlay
              muted
              loop
              playsInline
              className="h-full w-full object-cover"
            >
              <source src="/video.mp4" type="video/mp4" />
            </video>
          </div>

          <div className="relative z-10 container max-w-5xl text-center">
            <span className="mb-8 block animate-[revealAnim_1s_ease_forwards] font-mono text-sm uppercase tracking-[0.5em] text-yellow-300 opacity-0">
              High Fidelity 2026
            </span>

            <h1 className="kinetic-title text-[clamp(4rem,15vw,12rem)] font-black">
              FLUID
              <br />
              MOTION
            </h1>

            <div className="glass-layer-2 scroll-reveal mt-12 flex flex-col items-center justify-center gap-12 rounded-[3rem] border border-white/5 p-12 md:flex-row">
              <p className="max-w-xs text-left text-sm leading-relaxed text-white/40">
                Defining the next generation of visual interaction through{" "}
                <span className="text-white">
                  perceptual color spaces
                </span>{" "}
                and liquid depth geometry.
              </p>

              <div className="hidden h-px w-24 bg-white/10 md:block"></div>

              <button className="group flex items-center gap-4 text-yellow-300">
                <span className="text-xs font-bold uppercase tracking-widest">
                  Explore System
                </span>

                <Icon
                  icon="solar:alt-arrow-right-linear"
                  className="transition-transform group-hover:translate-x-2"
                />
              </button>
            </div>
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-[oklch(10%_0.01_250)] to-transparent"></div>
        </section>

        <section className="container mx-auto max-w-7xl px-6 py-32">
          <div className="grid h-auto grid-cols-1 gap-6 md:h-[800px] md:grid-cols-12">
            <div className="bento-card scroll-reveal group relative col-span-1 flex flex-col justify-end overflow-hidden rounded-[2.5rem] p-12 md:col-span-8">
              <div className="absolute right-0 top-0 p-8">
                <Icon
                  icon="si:ai-duotone"
                  className="text-6xl text-yellow-300/20"
                />
              </div>

              <h3 className="mb-4 text-4xl font-bold tracking-tighter">
                Perceptual OKLCH
              </h3>

              <p className="max-w-md text-white/50">
                Our hybrid system ensures consistent lightness across all
                gamuts, maintaining high-fidelity contrast in both light and
                dark modes.
              </p>
            </div>

            <div
              className="bento-card scroll-reveal col-span-1 flex flex-col items-center justify-center rounded-[2.5rem] p-12 text-center md:col-span-4"
              style={{ animationDelay: "0.1s" }}
            >
              <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full border-2 border-yellow-300">
                <Icon
                  icon="solar:cpu-bolt-bold-duotone"
                  className="text-4xl text-yellow-300"
                />
              </div>

              <h3 className="text-2xl font-bold tracking-tighter">
                120FPS Motion
              </h3>

              <p className="mt-2 text-sm text-white/50">
                Native Scroll-Timeline APIs.
              </p>
            </div>

            <div
              className="bento-card scroll-reveal col-span-1 rounded-[2.5rem] p-12 md:col-span-4"
              style={{ animationDelay: "0.2s" }}
            >
              <Icon
                icon="solar:layers-minimalistic-bold-duotone"
                className="mb-6 text-3xl text-yellow-300"
              />

              <h3 className="mb-2 text-xl font-bold tracking-tighter">
                Z-Axis Layering
              </h3>

              <p className="text-sm text-white/50">
                Complex depth hierarchies without performance overhead.
              </p>
            </div>

            <div
              className="bento-card scroll-reveal col-span-1 flex flex-col items-end gap-8 overflow-hidden rounded-[2.5rem] p-12 md:col-span-8 md:flex-row"
              style={{ animationDelay: "0.3s" }}
            >
              <div className="flex-1">
                <h3 className="mb-4 text-4xl font-bold tracking-tighter">
                  Liquid Metal UI
                </h3>

                <p className="text-white/50">
                  Simulating physical tension on every interaction.
                </p>
              </div>

              <div className="glass-layer-2 flex h-32 w-full items-center justify-center rounded-2xl border border-white/10 md:w-64">
                <div className="h-12 w-12 animate-pulse rounded-full bg-yellow-300 blur-xl"></div>
              </div>
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden py-64">
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-[40vh] w-[120vw] -translate-x-1/2 -translate-y-1/2 -rotate-6 bg-yellow-300/5 blur-[120px]"></div>

          <div className="container mx-auto max-w-5xl px-6 text-center">
            <div className="scroll-reveal">
              <h2 className="mb-16 text-5xl font-bold tracking-tighter md:text-7xl">
                Designed for
                <br />
                <span className="text-yellow-300/50">Sensations.</span>
              </h2>
            </div>

            <div className="relative mt-24 h-[500px] w-full">
              <div className="glass-layer-1 scroll-reveal absolute left-1/2 top-0 z-10 h-80 w-full max-w-2xl -translate-x-1/2 rounded-[3rem] border border-white/5"></div>

              <div
                className="glass-layer-2 scroll-reveal absolute left-1/2 top-20 z-20 flex h-80 w-[90%] max-w-xl -translate-x-1/2 items-center justify-center rounded-[3rem] border border-white/10 shadow-2xl"
                style={{ animationDelay: "0.2s" }}
              >
                <p className="font-mono text-sm tracking-widest text-yellow-300">
                  LAYERED DEPTH
                </p>
              </div>
            </div>
          </div>
        </section>

        <footer className="border-t border-white/5 bg-[oklch(15%_0.02_250/.3)] px-6 pb-16 pt-32">
          <div className="container mx-auto max-w-7xl">
            <div className="mb-32 grid gap-16 md:grid-cols-4">
              <div className="col-span-2">
                <h4 className="mb-8 text-3xl font-bold tracking-tighter">
                  Ready to evolve?
                </h4>

                <p className="mb-12 max-w-xs text-white/40">
                  Building the future of high-fidelity digital experiences since
                  2026.
                </p>

                <div className="flex gap-4">
                  <div className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-full border border-white/10 transition-colors hover:border-yellow-300">
                    <Icon icon="mdi:github" className="text-xl" />
                  </div>

                  <div className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-full border border-white/10 transition-colors hover:border-yellow-300">
                    <Icon icon="mdi:twitter" className="text-xl" />
                  </div>
                </div>
              </div>

              <div>
                <h5 className="mb-8 text-xs font-bold uppercase tracking-[0.3em] text-yellow-300">
                  Studio
                </h5>

                <ul className="space-y-4 text-sm text-white/50">
                  <li>
                    <a href="#" className="transition-colors hover:text-white">
                      Approach
                    </a>
                  </li>

                  <li>
                    <a href="#" className="transition-colors hover:text-white">
                      Technology
                    </a>
                  </li>

                  <li>
                    <a href="#" className="transition-colors hover:text-white">
                      Manifesto
                    </a>
                  </li>
                </ul>
              </div>

              <div>
                <h5 className="mb-8 text-xs font-bold uppercase tracking-[0.3em] text-yellow-300">
                  Contact
                </h5>

                <p className="mb-4 text-sm text-white/50">
                  hello@lumina.studio
                </p>

                <p className="text-sm text-white/50">
                  +1 (555) 000-0000
                </p>
              </div>
            </div>

            <div className="flex flex-col items-center justify-between border-t border-white/5 pt-8 text-[10px] font-bold uppercase tracking-[0.2em] text-white/20 md:flex-row">
              <p>&copy; 2026 Lumina Adaptive. All Rights Reserved.</p>

              <div className="mt-4 flex gap-8 md:mt-0">
                <a href="#">Privacy</a>
                <a href="#">Terms</a>
                <a href="#">Cookies</a>
              </div>
            </div>
          </div>
        </footer>
      </main>
    </>
  )
}