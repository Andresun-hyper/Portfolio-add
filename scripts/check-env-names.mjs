const forbidden = Object.keys(process.env).filter(key => /^VITE_.*(TOKEN|SECRET|PAT)/i.test(key));

if (forbidden.length > 0) {
  console.error(`Refusing to build with secret-like Vite env vars: ${forbidden.join(', ')}`);
  process.exit(1);
}
