import type { ForgeProviderKind } from "../types/forge";

const draftTitlePrefixPattern =
  /^\s*(?:\[(?:draft|wip)\]|\((?:draft|wip)\)|(?:draft|wip)\s*[:-])\s*/i;

function getDraftIndicatorLabel(provider: ForgeProviderKind) {
  return provider === "gitlab" ? "WIP" : "Draft";
}

function formatPullRequestDisplayTitle(title: string) {
  const formattedTitle = title.replace(draftTitlePrefixPattern, "").trimStart();
  return formattedTitle.length > 0 ? formattedTitle : title;
}

export { formatPullRequestDisplayTitle, getDraftIndicatorLabel };
