/// <reference types="astro/client" />

// @rollup/plugin-yaml turns .yaml imports into modules; the shape is enforced
// at build time by the Zod schema in src/data/schema.ts, not by this type.
declare module '*.yaml' {
  const data: unknown;
  export default data;
}
