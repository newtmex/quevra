import { indexer, type EvmOnEventContext } from "envio";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
type EventMeta = {
  chainId: number;
  block: { number: number; timestamp: number };
  logIndex: number;
  transaction: { hash: string };
};
type ActivityFields = {
  wallet?: string;
  tokenId?: bigint;
  kind: string;
  amount?: bigint;
  secondaryAmount?: bigint;
  relatedAddress?: string;
  secondaryAddress?: string;
  epoch?: bigint;
  cycle?: bigint;
  success?: boolean;
};

function activityId(event: EventMeta) {
  return `${event.chainId}_${event.block.number}_${event.logIndex}`;
}

function recordActivity(event: EventMeta, context: EvmOnEventContext, fields: ActivityFields) {
  context.Activity.set({
    id: activityId(event),
    wallet: fields.wallet?.toLowerCase(),
    tokenId: fields.tokenId,
    kind: fields.kind,
    amount: fields.amount ?? 0n,
    secondaryAmount: fields.secondaryAmount,
    relatedAddress: fields.relatedAddress?.toLowerCase(),
    secondaryAddress: fields.secondaryAddress?.toLowerCase(),
    blockNumber: BigInt(event.block.number),
    logIndex: event.logIndex,
    timestamp: BigInt(event.block.timestamp),
    transactionHash: event.transaction.hash,
    epoch: fields.epoch,
    cycle: fields.cycle,
    success: fields.success,
  });
}

async function positionOwner(context: EvmOnEventContext, tokenId: bigint) {
  return (await context.Position.get(`VE_MON_${tokenId}`))?.owner;
}

indexer.contractRegister({ contract: "StakingController", event: "VaultRegistered" }, async ({ event, context }) => {
  context.chain.StakingVault.add(event.params.vault);
});

indexer.contractRegister({ contract: "ValidatorsVoter", event: "BoostGaugeCreated" }, async ({ event, context }) => {
  context.chain.Gauge.add(event.params.gauge);
});

indexer.contractRegister({ contract: "ValidatorsVoter", event: "BribeVotingRewardsCreated" }, async ({ event, context }) => {
  context.chain.BribeVotingRewards.add(event.params.bribeVotingRewards);
});

indexer.onEvent({ contract: "VeMON", event: "Transfer" }, async ({ event, context }) => {
  const tokenId = event.params.tokenId;
  const id = `VE_MON_${tokenId}`;
  const current = await context.Position.get(id);
  const owner = event.params.to.toLowerCase();
  context.Position.set({
    id,
    tokenId,
    owner: owner === ZERO_ADDRESS ? undefined : owner,
    kind: "VE_MON",
    amount: current?.amount ?? 0n,
    unlockEpoch: current?.unlockEpoch,
    permanent: current?.permanent ?? false,
  });
  recordActivity(event, context, {
    wallet: owner === ZERO_ADDRESS ? event.params.from : owner,
    tokenId,
    kind: event.params.from.toLowerCase() === ZERO_ADDRESS ? "LOCK_MINTED" : owner === ZERO_ADDRESS ? "LOCK_BURNED" : "LOCK_TRANSFERRED",
    relatedAddress: event.params.from,
    secondaryAddress: event.params.to,
  });
});

indexer.onEvent({ contract: "VeValidator", event: "Transfer" }, async ({ event, context }) => {
  const tokenId = event.params.tokenId;
  const id = tokenId.toString();
  const owner = event.params.to.toLowerCase();
  const current = await context.Validator.get(id);
  context.Validator.set({
    id,
    tokenId,
    owner,
    operator: current?.operator,
    validatorId: current?.validatorId,
    vault: current?.vault,
    gauge: current?.gauge,
    bribe: current?.bribe,
    rewardToken: current?.rewardToken,
  });
  const positionId = `VE_VALIDATOR_${id}`;
  const currentPosition = await context.Position.get(positionId);
  context.Position.set({
    id: positionId,
    tokenId,
    owner: owner === ZERO_ADDRESS ? undefined : owner,
    kind: "VE_VALIDATOR",
    amount: currentPosition?.amount ?? 0n,
    unlockEpoch: undefined,
    permanent: true,
  });
  if (event.params.from.toLowerCase() === ZERO_ADDRESS && owner !== ZERO_ADDRESS) {
    recordActivity(event, context, { wallet: owner, tokenId, kind: "VALIDATOR_CREATED" });
  }
});

indexer.onEvent({ contract: "VeMON", event: "LockCreated" }, async ({ event, context }) => {
  const tokenId = event.params.tokenId;
  context.Position.set({
    id: `VE_MON_${tokenId}`,
    tokenId,
    owner: event.params.account.toLowerCase(),
    kind: "VE_MON",
    amount: event.params.amount,
    unlockEpoch: event.params.unlockEpoch,
    permanent: false,
  });
  recordActivity(event, context, {
    wallet: event.params.account,
    tokenId,
    kind: "LOCK_CREATED",
    amount: event.params.amount,
    epoch: event.params.unlockEpoch,
  });
});

indexer.onEvent({ contract: "VeMON", event: "LockPermanent" }, async ({ event, context }) => {
  const id = `VE_MON_${event.params.tokenId}`;
  const current = await context.Position.get(id);
  if (current) context.Position.set({ ...current, permanent: true, unlockEpoch: undefined, amount: event.params.amount });
  recordActivity(event, context, {
    wallet: event.params.account,
    tokenId: event.params.tokenId,
    kind: "LOCK_MADE_PERMANENT",
    amount: event.params.amount,
    epoch: BigInt(event.params.epoch),
  });
});

indexer.onEvent({ contract: "VeMON", event: "UnlockPermanent" }, async ({ event, context }) => {
  const id = `VE_MON_${event.params.tokenId}`;
  const current = await context.Position.get(id);
  if (current) context.Position.set({ ...current, permanent: false, unlockEpoch: undefined, amount: event.params.amount });
  recordActivity(event, context, {
    wallet: event.params.account,
    tokenId: event.params.tokenId,
    kind: "LOCK_MADE_FINITE",
    amount: event.params.amount,
    epoch: BigInt(event.params.epoch),
  });
});

async function recordLockAmount(event: EventMeta & { params: { tokenId: bigint; amount: bigint; newAmount: bigint } }, context: EvmOnEventContext, kind: string, prefix: "VE_MON" | "VE_VALIDATOR") {
  const id = `${prefix}_${event.params.tokenId}`;
  const position = await context.Position.get(id);
  if (position) context.Position.set({ ...position, amount: event.params.newAmount });
  recordActivity(event, context, {
    wallet: prefix === "VE_MON" ? await positionOwner(context, event.params.tokenId) : (await context.Validator.get(event.params.tokenId.toString()))?.owner,
    tokenId: event.params.tokenId,
    kind,
    amount: event.params.amount,
    secondaryAmount: event.params.newAmount,
  });
}

indexer.onEvent({ contract: "VeMON", event: "LockAmountIncreased" }, async ({ event, context }) => {
  await recordLockAmount(event, context, "LOCK_AMOUNT_INCREASED", "VE_MON");
});
indexer.onEvent({ contract: "VeMON", event: "LockAmountDecreased" }, async ({ event, context }) => {
  await recordLockAmount(event, context, "LOCK_AMOUNT_DECREASED", "VE_MON");
});
indexer.onEvent({ contract: "VeValidator", event: "LockAmountIncreased" }, async ({ event, context }) => {
  await recordLockAmount(event, context, "VALIDATOR_BACKING_INCREASED", "VE_VALIDATOR");
});
indexer.onEvent({ contract: "VeValidator", event: "LockAmountDecreased" }, async ({ event, context }) => {
  await recordLockAmount(event, context, "VALIDATOR_BACKING_DECREASED", "VE_VALIDATOR");
});

indexer.onEvent({ contract: "VeMON", event: "Checkpoint" }, async ({ event, context }) => {
  recordActivity(event, context, { kind: "VE_MON_CHECKPOINT", epoch: BigInt(event.params.epoch), amount: BigInt(event.params.pointIndex) });
});
indexer.onEvent({ contract: "VeValidator", event: "Checkpoint" }, async ({ event, context }) => {
  recordActivity(event, context, { kind: "VE_VALIDATOR_CHECKPOINT", epoch: BigInt(event.params.epoch), amount: BigInt(event.params.pointIndex) });
});

indexer.onEvent({ contract: "VeMON", event: "Approval" }, async ({ event, context }) => {
  recordActivity(event, context, { wallet: event.params.owner, tokenId: event.params.tokenId, kind: "LOCK_APPROVAL_SET", relatedAddress: event.params.approved });
});
indexer.onEvent({ contract: "VeMON", event: "ApprovalForAll" }, async ({ event, context }) => {
  recordActivity(event, context, { wallet: event.params.owner, kind: event.params.approved ? "LOCK_OPERATOR_APPROVED" : "LOCK_OPERATOR_REVOKED", relatedAddress: event.params.operator });
});
indexer.onEvent({ contract: "VeValidator", event: "Approval" }, async ({ event, context }) => {
  recordActivity(event, context, { wallet: event.params.owner, tokenId: event.params.tokenId, kind: "VALIDATOR_APPROVAL_SET", relatedAddress: event.params.approved });
});
indexer.onEvent({ contract: "VeValidator", event: "ApprovalForAll" }, async ({ event, context }) => {
  recordActivity(event, context, { wallet: event.params.owner, kind: event.params.approved ? "VALIDATOR_OPERATOR_APPROVED" : "VALIDATOR_OPERATOR_REVOKED", relatedAddress: event.params.operator });
});

indexer.onEvent({ contract: "StakingController", event: "VeSet" }, async ({ event, context }) => {
  recordActivity(event, context, { kind: "VOTING_ESCROW_CONFIGURED", relatedAddress: event.params.ve });
});
indexer.onEvent({ contract: "StakingController", event: "VaultRegistered" }, async ({ event, context }) => {
  const id = event.params.tokenId.toString();
  const validator = await context.Validator.get(id);
  if (validator) context.Validator.set({ ...validator, vault: event.params.vault.toLowerCase(), operator: event.params.operator.toLowerCase() });
  recordActivity(event, context, { wallet: event.params.operator, tokenId: event.params.tokenId, kind: "VALIDATOR_VAULT_REGISTERED", relatedAddress: event.params.vault });
});
indexer.onEvent({ contract: "StakingController", event: "ValidatorCommissionSet" }, async ({ event, context }) => {
  recordActivity(event, context, { kind: "VALIDATOR_COMMISSION_SET", amount: event.params.commission });
});
indexer.onEvent({ contract: "StakingController", event: "ValidatorCommissionScheduled" }, async ({ event, context }) => {
  recordActivity(event, context, { kind: "VALIDATOR_COMMISSION_SCHEDULED", amount: event.params.commission, cycle: BigInt(event.params.effectiveCycle) });
});
indexer.onEvent({ contract: "StakingController", event: "AgentCreated" }, async ({ event, context }) => {
  recordActivity(event, context, { wallet: await positionOwner(context, event.params.tokenId), tokenId: event.params.tokenId, kind: "STAKING_AGENT_CREATED", relatedAddress: event.params.agent });
});
indexer.onEvent({ contract: "StakingController", event: "MONDeposited" }, async ({ event, context }) => {
  recordActivity(event, context, { wallet: await positionOwner(context, event.params.tokenId), tokenId: event.params.tokenId, kind: "MON_DEPOSITED", amount: event.params.amount });
});
indexer.onEvent({ contract: "StakingController", event: "Staked" }, async ({ event, context }) => {
  recordActivity(event, context, { wallet: await positionOwner(context, event.params.tokenId), tokenId: event.params.tokenId, kind: "STAKED", amount: event.params.amount });
});
indexer.onEvent({ contract: "StakingController", event: "StakingIntentSet" }, async ({ event, context }) => {
  recordActivity(event, context, { wallet: await positionOwner(context, event.params.tokenId), tokenId: event.params.tokenId, kind: "STAKING_INTENT_SET", cycle: BigInt(event.params.cycle) });
});
indexer.onEvent({ contract: "StakingController", event: "StakingPoked" }, async ({ event, context }) => {
  recordActivity(event, context, { wallet: await positionOwner(context, event.params.tokenId), tokenId: event.params.tokenId, kind: "STAKING_SETTLEMENT_POKED", cycle: BigInt(event.params.cycle), success: event.params.satisfied });
});
indexer.onEvent({ contract: "StakingController", event: "Unstaked" }, async ({ event, context }) => {
  recordActivity(event, context, { wallet: await positionOwner(context, event.params.tokenId), tokenId: event.params.tokenId, kind: "UNSTAKED", amount: event.params.amount });
});
indexer.onEvent({ contract: "StakingController", event: "Compounded" }, async ({ event, context }) => {
  recordActivity(event, context, { wallet: await positionOwner(context, event.params.tokenId), tokenId: event.params.tokenId, kind: "COMPOUNDED", amount: event.params.amount });
});
indexer.onEvent({ contract: "StakingController", event: "Withdrawn" }, async ({ event, context }) => {
  recordActivity(event, context, { wallet: await positionOwner(context, event.params.tokenId), tokenId: event.params.tokenId, kind: "WITHDRAWN", amount: event.params.amount });
});
indexer.onEvent({ contract: "StakingController", event: "RewardsClaimed" }, async ({ event, context }) => {
  recordActivity(event, context, { wallet: await positionOwner(context, event.params.tokenId), tokenId: event.params.tokenId, kind: "REWARDS_CLAIMED", amount: event.params.amount });
});

indexer.onEvent({ contract: "ValidatorsVoter", event: "WhitelistToken" }, async ({ event, context }) => {
  recordActivity(event, context, { wallet: event.params.whitelister, kind: event.params.whitelisted ? "INCENTIVE_TOKEN_WHITELISTED" : "INCENTIVE_TOKEN_UNWHITELISTED", relatedAddress: event.params.token });
});
indexer.onEvent({ contract: "ValidatorsVoter", event: "BoostGaugeCreated" }, async ({ event, context }) => {
  const id = event.params.boostableTokenId.toString();
  const validator = await context.Validator.get(id);
  const owner = validator?.owner;
  if (validator) context.Validator.set({ ...validator, gauge: event.params.gauge.toLowerCase(), rewardToken: event.params.rewardToken.toLowerCase() });
  context.DynamicRewardContract.set({ id: event.params.gauge.toLowerCase(), tokenId: event.params.boostableTokenId, wallet: owner, kind: "GAUGE", rewardToken: event.params.rewardToken.toLowerCase() });
  recordActivity(event, context, { wallet: owner, tokenId: event.params.boostableTokenId, kind: "GAUGE_CREATED", relatedAddress: event.params.gauge, secondaryAddress: event.params.rewardToken });
});
indexer.onEvent({ contract: "ValidatorsVoter", event: "BribeVotingRewardsCreated" }, async ({ event, context }) => {
  const id = event.params.boostableTokenId.toString();
  const validator = await context.Validator.get(id);
  const owner = validator?.owner;
  if (validator) context.Validator.set({ ...validator, bribe: event.params.bribeVotingRewards.toLowerCase() });
  context.DynamicRewardContract.set({ id: event.params.bribeVotingRewards.toLowerCase(), tokenId: event.params.boostableTokenId, wallet: owner, kind: "BRIBE", rewardToken: undefined });
  recordActivity(event, context, { wallet: owner, tokenId: event.params.boostableTokenId, kind: "BRIBE_CREATED", relatedAddress: event.params.bribeVotingRewards });
});
indexer.onEvent({ contract: "ValidatorsVoter", event: "BoostPoked" }, async ({ event, context }) => {
  const owner = (await context.Validator.get(event.params.boostableTokenId.toString()))?.owner;
  recordActivity(event, context, { wallet: owner, tokenId: event.params.boostableTokenId, kind: "VALIDATOR_BOOST_UPDATED", amount: event.params.boost });
});
indexer.onEvent({ contract: "ValidatorsVoter", event: "BoostableTokenBurned" }, async ({ event, context }) => {
  const id = event.params.boostableTokenId.toString();
  const validator = await context.Validator.get(id);
  if (validator) context.Validator.set({ ...validator, gauge: undefined, bribe: undefined, rewardToken: undefined });
  recordActivity(event, context, { wallet: validator?.owner, tokenId: event.params.boostableTokenId, kind: "VALIDATOR_GAUGE_REMOVED", relatedAddress: event.params.gauge });
});
indexer.onEvent({ contract: "ValidatorsVoter", event: "StakeVoteSynced" }, async ({ event, context }) => {
  recordActivity(event, context, {
    wallet: await positionOwner(context, event.params.tokenId),
    tokenId: event.params.tokenId,
    kind: "VALIDATOR_VOTE_WEIGHT_SYNCED",
    amount: event.params.allocation,
    secondaryAmount: event.params.newWeight,
    relatedAddress: event.params.gauge,
  });
});

indexer.onEvent({ contract: "Gauge", event: "NotifyReward" }, async ({ event, context }) => {
  const contract = await context.DynamicRewardContract.get(event.srcAddress.toLowerCase());
  recordActivity(event, context, { wallet: contract?.wallet, tokenId: contract?.tokenId, kind: "GAUGE_REWARD_FUNDED", amount: event.params.amount, relatedAddress: event.srcAddress, secondaryAddress: event.params.from });
});
indexer.onEvent({ contract: "Gauge", event: "ClaimRewards" }, async ({ event, context }) => {
  const contract = await context.DynamicRewardContract.get(event.srcAddress.toLowerCase());
  recordActivity(event, context, { wallet: event.params.account, tokenId: contract?.tokenId, kind: "GAUGE_REWARDS_CLAIMED", amount: event.params.amount, relatedAddress: event.srcAddress });
});

indexer.onEvent({ contract: "BribeVotingRewards", event: "Deposit" }, async ({ event, context }) => {
  recordActivity(event, context, { wallet: await positionOwner(context, event.params.tokenId), tokenId: event.params.tokenId, kind: "VOTING_WEIGHT_ADDED", amount: event.params.amount, relatedAddress: event.srcAddress });
});
indexer.onEvent({ contract: "BribeVotingRewards", event: "Withdraw" }, async ({ event, context }) => {
  recordActivity(event, context, { wallet: await positionOwner(context, event.params.tokenId), tokenId: event.params.tokenId, kind: "VOTING_WEIGHT_REMOVED", amount: event.params.amount, relatedAddress: event.srcAddress });
});
indexer.onEvent({ contract: "BribeVotingRewards", event: "NotifyReward" }, async ({ event, context }) => {
  const contract = await context.DynamicRewardContract.get(event.srcAddress.toLowerCase());
  recordActivity(event, context, { wallet: event.params.from, tokenId: contract?.tokenId, kind: "BRIBE_REWARD_FUNDED", amount: event.params.amount, relatedAddress: event.srcAddress, secondaryAddress: event.params.reward, cycle: BigInt(event.params.cycle) });
});
indexer.onEvent({ contract: "BribeVotingRewards", event: "ClaimRewards" }, async ({ event, context }) => {
  const contract = await context.DynamicRewardContract.get(event.srcAddress.toLowerCase());
  recordActivity(event, context, { wallet: event.params.from, tokenId: contract?.tokenId, kind: "BRIBE_REWARDS_CLAIMED", amount: event.params.amount, relatedAddress: event.srcAddress, secondaryAddress: event.params.reward });
});

indexer.onEvent({ contract: "StakingVault", event: "RewardsSynced" }, async ({ event, context }) => {
  recordActivity(event, context, { kind: "VAULT_REWARDS_SYNCED", amount: event.params.newlyAccrued, secondaryAmount: event.params.rewardPerShare, relatedAddress: event.srcAddress });
});
indexer.onEvent({ contract: "StakingVault", event: "RewardPaid" }, async ({ event, context }) => {
  recordActivity(event, context, { wallet: await positionOwner(context, event.params.tokenId), tokenId: event.params.tokenId, kind: "VAULT_REWARD_PAID", amount: event.params.amount, relatedAddress: event.srcAddress, secondaryAddress: event.params.recipient });
});
