// Vite (app build and vitest) imports text files with the ?raw suffix.
declare module '*.md?raw' {
  const text: string;
  export default text;
}
