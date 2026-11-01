export default function Template({ children }: { children: React.ReactNode }) {
  // re-mounts on every navigation: a short fade-and-rise, nothing more
  return <div className="page-in">{children}</div>;
}
