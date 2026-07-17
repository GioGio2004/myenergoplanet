// The dist (UMD) builds of gsap ship without their own type declarations.
// Map them onto the package's normal types so we can import from "gsap/dist/*"
// (single-instance builds — see the comment in components/landing/Landing.tsx).
declare module "gsap/dist/gsap" {
  export * from "gsap";
}
declare module "gsap/dist/ScrollTrigger" {
  export * from "gsap/ScrollTrigger";
}
