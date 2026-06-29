export type CommonFields = {
  repository: string;
  claudeCommentId: string;
  triggerPhrase: string;
  triggerUsername?: string;
  customInstructions?: string;
  allowedTools?: string;
  disallowedTools?: string;
  directPrompt?: string;
};

type PullRequestReviewCommentEvent = {
  eventName: "pull_request_review_comment";
  isPR: true;
  prNumber: string;
  commentId?: string; // May be present for review comments
  commentBody: string;
  claudeBranch?: string;
  baseBranch?: string;
};

type PullRequestReviewEvent = {
  eventName: "pull_request_review";
  isPR: true;
  prNumber: string;
  commentBody: string;
  claudeBranch?: string;
  baseBranch?: string;
};

type IssueCommentEvent = {
  eventName: "issue_comment";
  commentId: string;
  issueNumber: string;
  isPR: false;
  baseBranch: string;
  claudeBranch: string;
  commentBody: string;
};

// Not actually a real github event, since issue comments and PR coments are both sent as issue_comment
type PullRequestCommentEvent = {
  eventName: "issue_comment";
  commentId: string;
  prNumber: string;
  isPR: true;
  commentBody: string;
  claudeBranch?: string;
  baseBranch?: string;
};

type IssueOpenedEvent = {
  eventName: "issues";
  eventAction: "opened";
  isPR: false;
  issueNumber: string;
  baseBranch: string;
  claudeBranch?: string;
};

type IssueAssignedEvent = {
  eventName: "issues";
  eventAction: "assigned";
  isPR: false;
  issueNumber: string;
  baseBranch: string;
  claudeBranch?: string;
  assigneeTrigger?: string;
};

type IssueLabeledEvent = {
  eventName: "issues";
  eventAction: "labeled";
  isPR: false;
  issueNumber: string;
  baseBranch: string;
  claudeBranch?: string;
  labelTrigger: string;
};

type PullRequestEvent = {
  eventName: "pull_request";
  eventAction?: string; // opened, synchronize, etc.
  isPR: true;
  prNumber: string;
  claudeBranch?: string;
  baseBranch?: string;
};

// workflow_dispatch から直接起動された軽量モード。
// issue/PR コンテキストを持たず、`direct_prompt` を主体に動く。
// dispatchInputs は workflow_dispatch.inputs の生値（CLI でいう -f key=value 群）。
// taskKey/existingPrNumber/doneMarker はタスク継続モード（同一 task_key の open PR を
// 流用して進める運用）で使う。詳細は prepare.ts の継続ロジックを参照。
type WorkflowDispatchEvent = {
  eventName: "workflow_dispatch";
  isPR: false;
  baseBranch: string;
  claudeBranch: string;
  runId: string;
  dispatchInputs: Record<string, string>;
  taskKey?: string;
  existingPrNumber?: number;
  doneMarker: string;
  // workingBranch がセットされていれば、claudeBranch は呼び出し側で確定したブランチ名であり、
  // PR まわり / 完了判定の指示は呼び出し側の direct_prompt 側に委ねる（Issue 連動など）。
  workingBranchOverride?: boolean;
};

// Union type for all possible event types
export type EventData =
  | PullRequestReviewCommentEvent
  | PullRequestReviewEvent
  | PullRequestCommentEvent
  | IssueCommentEvent
  | IssueOpenedEvent
  | IssueAssignedEvent
  | IssueLabeledEvent
  | PullRequestEvent
  | WorkflowDispatchEvent;

// Combined type with separate eventData field
export type PreparedContext = CommonFields & {
  eventData: EventData;
};
