/** @type {import('next').NextConfig} */
const nextConfig = {
  // The webhook/LLM routes are serverless functions; nothing special needed.
  // Keep server-only secrets out of the client bundle by never importing
  // lib/* into client components.
};

export default nextConfig;
