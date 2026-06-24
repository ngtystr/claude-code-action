#!/usr/bin/env bun

/**
 * Check if the action trigger is from a human actor
 * Prevents automated tools or bots from triggering Claude
 */

import type { Octokit } from "@octokit/rest";
import type { ParsedGitHubContext } from "../context";

export async function checkHumanActor(
  octokit: Octokit,
  githubContext: ParsedGitHubContext,
) {
  // Fetch user information from GitHub API
  const { data: userData } = await octokit.users.getByUsername({
    username: githubContext.actor,
  });

  const actorType = userData.type;

  console.log(`Actor type: ${actorType}`);

  const ALLOWED_BOTS = ["claude", "github-actions"]; // [bot] サフィックス抜きで指定

  if (actorType !== "User") {
    const normalized = githubContext.actor.toLowerCase().replace(/\[bot\]$/, "");
    if (ALLOWED_BOTS.includes(normalized)) {
      console.log(`Actor ${githubContext.actor} is in allowed bots, skipping human actor check`);
      return;
    }
    throw new Error(
      `Workflow initiated by non-human actor: ${githubContext.actor} (type: ${actorType}).`,
    );
  }

  console.log(`Verified human actor: ${githubContext.actor}`);
}
