#!/usr/bin/env bun

/**
 * Prepare the Claude action by checking trigger conditions, verifying human actor,
 * and creating the initial tracking comment
 */

import * as core from "@actions/core";
import { $ } from "bun";
import { setupGitHubToken } from "../github/token";
import { checkTriggerAction } from "../github/validation/trigger";
import { checkHumanActor } from "../github/validation/actor";
import { checkWritePermissions } from "../github/validation/permissions";
import { createInitialComment } from "../github/operations/comments/create-initial";
import { setupBranch, type BranchInfo } from "../github/operations/branch";
import { updateTrackingComment } from "../github/operations/comments/update-with-branch";
import { prepareMcpConfig } from "../mcp/install-mcp-server";
import { createPrompt } from "../create-prompt";
import { createOctokit } from "../github/api/client";
import { fetchGitHubData, type FetchDataResult } from "../github/data/fetcher";
import { parseGitHubContext } from "../github/context";

async function run() {
  try {
    // Step 1: Setup GitHub token
    const githubToken = await setupGitHubToken();
    const octokit = createOctokit(githubToken);

    // Step 2: Parse GitHub context (once for all operations)
    const context = parseGitHubContext();
    // workflow_dispatch: issue/PR 不在の軽量経路。初期コメント / fetchGitHubData / PR 検出 /
    // updateTrackingComment はすべてスキップし、独自に作業ブランチを作って direct_prompt を流す。
    const isDispatch = context.eventName === "workflow_dispatch";

    // Step 3: Check write permissions
    const hasWritePermissions = await checkWritePermissions(
      octokit.rest,
      context,
    );
    if (!hasWritePermissions) {
      throw new Error(
        "Actor does not have write permissions to the repository",
      );
    }

    // Step 4: Check trigger conditions
    const containsTrigger = await checkTriggerAction(context);

    if (!containsTrigger) {
      console.log("No trigger found, skipping remaining steps");
      return;
    }

    // Step 5: Check if actor is human
    await checkHumanActor(octokit.rest, context);

    // Step 6: Create initial tracking comment（workflow_dispatch は付帯コメントを持たないので skip）
    const commentId = isDispatch
      ? 0
      : await createInitialComment(octokit.rest, context);

    // Step 7: Fetch GitHub data（workflow_dispatch では entity が無いので skip → githubData=null）
    const githubData: FetchDataResult | null = isDispatch
      ? null
      : await fetchGitHubData({
          octokits: octokit,
          repository: `${context.repository.owner}/${context.repository.repo}`,
          prNumber: context.entityNumber.toString(),
          isPR: context.isPR,
          triggerUsername: context.actor,
        });

    // Step 8: Setup branch
    // setup_branch=false の repo（トリアージ用ハブ等、このリポジトリにコミットしない用途）では
    // 新規ブランチを作らず、base ブランチ上で読み取り専用に動かす。claudeBranch を undefined に
    // することで、以降の分岐は「open PR」と同じ扱いになり、空ブランチを作らずに済む。
    let branchInfo: BranchInfo;
    if (process.env.SETUP_BRANCH === "false") {
      const baseBranch =
        context.inputs.baseBranch ||
        (
          await octokit.rest.repos.get({
            owner: context.repository.owner,
            repo: context.repository.repo,
          })
        ).data.default_branch;
      branchInfo = { baseBranch, currentBranch: baseBranch };
      console.log(
        `SETUP_BRANCH=false: skipping branch creation, operating read-only on ${baseBranch}`,
      );
    } else if (isDispatch) {
      // workflow_dispatch では setupBranch（issue/PR 前提）を使わず、独自に新規ブランチを作る。
      // 命名は ${branchPrefix}workflow-${runId} で衝突を回避し、複数 dispatch が並走しても
      // 各々独立した作業ブランチを持つ。base は inputs.baseBranch、無ければ default branch。
      const baseBranch =
        context.inputs.baseBranch ||
        (
          await octokit.rest.repos.get({
            owner: context.repository.owner,
            repo: context.repository.repo,
          })
        ).data.default_branch;
      const newBranch = `${context.inputs.branchPrefix}workflow-${context.runId}`;
      console.log(
        `workflow_dispatch: creating new branch ${newBranch} from ${baseBranch}`,
      );
      const baseRef = await octokit.rest.git.getRef({
        owner: context.repository.owner,
        repo: context.repository.repo,
        ref: `heads/${baseBranch}`,
      });
      await octokit.rest.git.createRef({
        owner: context.repository.owner,
        repo: context.repository.repo,
        ref: `refs/heads/${newBranch}`,
        sha: baseRef.data.object.sha,
      });
      await $`git fetch origin --depth=1 ${newBranch}`;
      await $`git checkout ${newBranch}`;
      core.setOutput("CLAUDE_BRANCH", newBranch);
      core.setOutput("BASE_BRANCH", baseBranch);
      branchInfo = {
        baseBranch,
        claudeBranch: newBranch,
        currentBranch: newBranch,
      };
    } else {
      branchInfo = await setupBranch(octokit, githubData!, context);
    }

    // Step 9: Determine the correct comment ID to use
    let finalCommentId = commentId;
    
    // If we created a new branch for an issue and there's a PR, create a new comment on the PR
    if (branchInfo.claudeBranch && !context.isPR) {
      // Check if a PR exists for this branch
      try {
        const { data: prs } = await octokit.rest.pulls.list({
          owner: context.repository.owner,
          repo: context.repository.repo,
          head: `${context.repository.owner}:${branchInfo.claudeBranch}`,
          state: 'open'
        });
        
                 if (prs.length > 0 && prs[0]) {
           // PR exists, create a new comment on the PR
           const prNumber = prs[0].number;
          console.log(`Found PR #${prNumber} for branch ${branchInfo.claudeBranch}, creating new comment`);
          
                     const prCommentResponse = await octokit.rest.issues.createComment({
             owner: context.repository.owner,
             repo: context.repository.repo,
             issue_number: prNumber,
             body: "🤖 Claude is working on this...\n\n<img src=\"https://github.com/user-attachments/assets/5ac382c7-e004-429b-8e35-7feb3e8f9c6f\" width=\"14px\" height=\"14px\" style=\"vertical-align: middle; margin-left: 4px;\" />"
           });
          
          finalCommentId = prCommentResponse.data.id;
          console.log(`✅ Created new PR comment with ID: ${finalCommentId}`);
          
          // Update environment variable for downstream steps
          core.exportVariable("CLAUDE_COMMENT_ID", finalCommentId.toString());
        }
      } catch (error) {
        console.log(`No PR found for branch ${branchInfo.claudeBranch}, using original comment`);
      }
    }

    // Step 10: Update initial comment with branch link (only for issues that created a new branch)
    if (branchInfo.claudeBranch && finalCommentId === commentId) {
      // Only update the original comment if we didn't create a new PR comment
      await updateTrackingComment(
        octokit,
        context,
        commentId,
        branchInfo.claudeBranch,
      );
    }

    // Step 11: Create prompt file
    await createPrompt(
      commentId,
      branchInfo.baseBranch,
      branchInfo.claudeBranch,
      githubData,
      context,
    );

    // Step 11: Get MCP configuration
    const additionalMcpConfig = process.env.MCP_CONFIG || "";
    const mcpConfig = await prepareMcpConfig({
      githubToken,
      owner: context.repository.owner,
      repo: context.repository.repo,
      branch: branchInfo.currentBranch,
      additionalMcpConfig,
      claudeCommentId: commentId.toString(),
      allowedTools: context.inputs.allowedTools,
    });
    core.setOutput("mcp_config", mcpConfig);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.setFailed(`Prepare step failed with error: ${errorMessage}`);
    // Also output the clean error message for the action to capture
    core.setOutput("prepare_error", errorMessage);
    process.exit(1);
  }
}

if (import.meta.main) {
  run();
}
