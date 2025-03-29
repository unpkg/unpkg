export interface GitHubRepo {
  owner: string;
  repo: string;
}

export function parseGitHubRepo(repoUrl: string): GitHubRepo | null {
  try {
    let url = new URL(repoUrl);

    if (url.hostname === "github.com") {
      let pathParts = url.pathname.split("/").filter(Boolean);
      return {
        owner: pathParts[0],
        repo: pathParts[1].replace(/\.git$/, ""),
      };
    }
  } catch (error) {
    // ignore
  }

  return null;
}

export function createGitHubUrl(repo: GitHubRepo): URL {
  return new URL(`/${repo.owner}/${repo.repo}`, "https://github.com");
}
