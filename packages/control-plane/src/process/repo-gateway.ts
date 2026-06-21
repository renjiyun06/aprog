// 仓库网关：进程的 git 仓库「创建」收口于此。
// spawn 时为进程建一个【私有】仓库（名 aprog-proc-<pid>），返回实际 clone URL 存进 PCB.repo_url。
// 沙箱侧的 clone / push 仍是 mock，不在这里（见 sandbox-gateway.ts）。
// 模型见 docs/proc-storage.html#provisioning：进程 = git 仓库、仓库名带前缀不裸用数字、地址入库。
//
// 真实实现 GitHubRepoGateway 调 GitHub API 建私有库；未配 GITHUB_TOKEN 时用 MockRepoGateway 顶（造假 URL）。
// 接入别的 host（Gitea/Forgejo）只需新增一个实现替换，ProcessManager 的编排不动。

export interface RepoCreated {
  /** 实际 clone URL（不含凭证），写入 PCB.repo_url。 */
  repoUrl: string;
}

export interface RepoGateway {
  /** 为进程建一个私有仓库（名 aprog-proc-<pid>）。返回 clone URL。
   *  注意：不向 GitHub 写任何描述性信息（进程名 / program / pid 等不暴露到仓库元数据）。 */
  create(p: { pid: number; programId: string }): Promise<RepoCreated>;
}

/** 仓库名由 pid 推导：带前缀的合法名，不裸用数字（见 docs/proc-storage.html#provisioning）。 */
export function repoName(pid: number): string {
  return `aprog-proc-${pid}`;
}

/** Mock：不真建库，只造可观测的假 clone URL，便于先把链路跑通（未配 GITHUB_TOKEN 时用）。 */
export class MockRepoGateway implements RepoGateway {
  async create(p: { pid: number; programId: string }): Promise<RepoCreated> {
    const repoUrl = `https://mock-git.local/aprog/${repoName(p.pid)}.git`;
    console.log(`[mock-repo] create ${repoName(p.pid)}（program=${p.programId}）→ ${repoUrl}`);
    return { repoUrl };
  }
}

export interface GitHubRepoConfig {
  /** PAT，scope: repo（建私有库）。 */
  token: string;
  /** 仓库 owner：org 名或用户名。 */
  owner: string;
  /** owner 是否为组织：true → POST /orgs/{owner}/repos；false → POST /user/repos。 */
  ownerIsOrg: boolean;
}

/** 真实：调 GitHub API 建 private 仓库。建【空库】（auto_init=false）以保「spawned 无 commit」的语义。 */
export class GitHubRepoGateway implements RepoGateway {
  constructor(private readonly cfg: GitHubRepoConfig) {}

  async create(p: { pid: number; programId: string }): Promise<RepoCreated> {
    const name = repoName(p.pid);
    const endpoint = this.cfg.ownerIsOrg
      ? `https://api.github.com/orgs/${this.cfg.owner}/repos`
      : 'https://api.github.com/user/repos';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.cfg.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'aprog-control-plane',
      },
      // 不写 description：进程名 / program / pid 等信息不暴露到 GitHub 仓库元数据。
      body: JSON.stringify({
        name,
        private: true,
        auto_init: false, // 建空库：不提交 commit-0（保 spawned 无检查点的语义）
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`[github-repo] 建库失败 ${res.status} ${name}：${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as { clone_url?: string };
    const repoUrl = data.clone_url;
    if (typeof repoUrl !== 'string' || repoUrl === '') {
      throw new Error(`[github-repo] 建库返回缺 clone_url：${name}`);
    }
    console.log(`[github-repo] create ${this.cfg.owner}/${name}（private）→ ${repoUrl}`);
    return { repoUrl };
  }
}
