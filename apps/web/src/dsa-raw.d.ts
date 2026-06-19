// Raw text import of bundled DAZ Script runtime files (Vite `?raw`).
declare module '*.dsa?raw' {
  const content: string
  export default content
}
