// Experimental shadow proposal only. src/ and dist/ never import this module.
// These metadata must originate from the host, never from parsing user text.
export function bindingProposal(input, snapshot, liveTopicIds) {
  const proposals = []
  if (input.replyTo?.trusted === true) {
    const target = snapshot.messages?.find(message => message.messageId === input.replyTo.messageId && message.sessionId === input.replyTo.sessionId)
    if (!target || !['user', 'foreground'].includes(target.source) || target.revoked) return undefined
    proposals.push({ topicId: target.topicId, basis: 'explicit-reply' })
  }
  if (input.trustedHostResponse === true && input.requestId) {
    const owner = snapshot.pending?.find(pending => pending.id === input.requestId && pending.basis === 'host-request')
    if (!owner) return undefined
    proposals.push({ topicId: owner.topicId, basis: 'host-request' })
  }
  if (input.steering?.trusted === true) {
    const steering = input.steering
    if (!steering.roundId || steering.roundId !== steering.activeRoundId) return undefined
    proposals.push({ topicId: steering.topicId, basis: 'same-round-steering' })
  }
  if (!proposals.length || proposals.some(p => !liveTopicIds.includes(p.topicId))) return undefined
  if (new Set(proposals.map(p => p.topicId)).size !== 1) return undefined
  return { topicId: proposals[0].topicId, basis: proposals.map(p => p.basis) }
}