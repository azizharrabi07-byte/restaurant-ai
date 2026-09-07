import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#fdf6ef",
          100: "#f9e7d7",
          200: "#f2ccae",
          300: "#e9aa7b",
          400: "#df8146",
          500: "#d46324",
          600: "#c04e1c",
          700: "#a03b1a",
          800: "#82301b",
          900: "#6b2a19",
        },
      },
    },
  },
  plugins: [],
};
export default config;