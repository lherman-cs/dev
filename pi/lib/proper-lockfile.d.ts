declare module "proper-lockfile" {
  type LockOptions = { lockfilePath?: string; retries?: number };
  type Release = () => void | Promise<void>;
  const lockfile: { lock(path: string, options?: LockOptions): Promise<Release> };
  export default lockfile;
}
