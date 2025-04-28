import { Clarinet, Tx, Chain, Account, types } from 'https://deno.land/x/clarinet@v0.14.0/index.ts';
import { assertEquals } from 'https://deno.land/std@0.90.0/testing/asserts.ts';

Clarinet.test({
    name: "Ensure content submission works properly",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const user1 = accounts.get('wallet_1')!;

        // Submit new content
        const contentHash = "0x6862796520726f626572746f2074686973206973206120636f6e74656e74206861736821";
        let block = chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'submit-content',
                [types.buff(contentHash)],
                user1.address
            )
        ]);

        // Check if content submission was successful
        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok u1)'); // First content ID

        // Verify content details
        const contentCheck = chain.callReadOnlyFn(
            'content-moderation',
            'get-content',
            [types.uint(1)],
            user1.address
        );

        const contentString = contentCheck.result.replace('(some ', '').slice(0, -1);
        assertEquals(contentString.includes(`author: ${user1.address}`), true);
        assertEquals(contentString.includes(`content-hash: ${contentHash}`), true);
        assertEquals(contentString.includes('status: "pending"'), true);
        assertEquals(contentString.includes('votes-for: u0'), true);
        assertEquals(contentString.includes('votes-against: u0'), true);

        // Submit another content from the same user
        block = chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'submit-content',
                [types.buff("0x7365636f6e6420636f6e74656e74206861736821")],
                user1.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok u2)'); // Second content ID
    },
});

Clarinet.test({
    name: "Test voting on content and reputation management",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const author = accounts.get('wallet_1')!;
        const voter1 = accounts.get('wallet_2')!;
        const voter2 = accounts.get('wallet_3')!;

        // First, give voters enough reputation to vote
        chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'initialize-reputation',
                [types.principal(voter1.address), types.uint(200)],
                deployer.address
            ),
            Tx.contractCall(
                'content-moderation',
                'initialize-reputation',
                [types.principal(voter2.address), types.uint(200)],
                deployer.address
            )
        ]);

        // Submit content
        chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'submit-content',
                [types.buff("0x636f6e74656e7420666f7220766f74696e6720746573742068617368")],
                author.address
            )
        ]);

        // Vote on content
        let block = chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'vote',
                [types.uint(1), types.bool(true)], // Approve content
                voter1.address
            )
        ]);

        // Check if vote was successful
        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Verify vote was counted
        const contentCheck = chain.callReadOnlyFn(
            'content-moderation',
            'get-content',
            [types.uint(1)],
            deployer.address
        );

        const contentString = contentCheck.result.replace('(some ', '').slice(0, -1);
        assertEquals(contentString.includes('votes-for: u1'), true);
        assertEquals(contentString.includes('votes-against: u0'), true);

        // Check if voter reputation was updated
        const reputationCheck = chain.callReadOnlyFn(
            'content-moderation',
            'get-user-reputation',
            [types.principal(voter1.address)],
            deployer.address
        );

        const reputationString = reputationCheck.result.replace('{', '').replace('}', '').trim();
        assertEquals(reputationString.includes('score: u210'), true); // 200 + 10 (VOTE_REWARD)

        // Another voter votes against
        block = chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'vote',
                [types.uint(1), types.bool(false)], // Reject content
                voter2.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Verify both votes were counted
        const updatedContent = chain.callReadOnlyFn(
            'content-moderation',
            'get-content',
            [types.uint(1)],
            deployer.address
        );

        const updatedString = updatedContent.result.replace('(some ', '').slice(0, -1);
        assertEquals(updatedString.includes('votes-for: u1'), true);
        assertEquals(updatedString.includes('votes-against: u1'), true);

        // Try to vote again (should fail)
        block = chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'vote',
                [types.uint(1), types.bool(true)],
                voter1.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u2)'); // ERR-ALREADY-VOTED

        // Try to vote without sufficient reputation
        const lowRepVoter = accounts.get('wallet_4')!;
        block = chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'vote',
                [types.uint(1), types.bool(true)],
                lowRepVoter.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u4)'); // ERR-INSUFFICIENT-REPUTATION
    },
});

Clarinet.test({
    name: "Test finalization of content moderation decisions",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const author = accounts.get('wallet_1')!;
        const voter1 = accounts.get('wallet_2')!;
        const voter2 = accounts.get('wallet_3')!;
        const voter3 = accounts.get('wallet_4')!;

        // Initialize voter reputations
        chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'initialize-reputation',
                [types.principal(voter1.address), types.uint(200)],
                deployer.address
            ),
            Tx.contractCall(
                'content-moderation',
                'initialize-reputation',
                [types.principal(voter2.address), types.uint(200)],
                deployer.address
            ),
            Tx.contractCall(
                'content-moderation',
                'initialize-reputation',
                [types.principal(voter3.address), types.uint(200)],
                deployer.address
            )
        ]);

        // Submit content
        chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'submit-content',
                [types.buff("0x746573742066696e616c697a6174696f6e20636f6e74656e742068617368")],
                author.address
            )
        ]);

        // Vote on content (2 for, 1 against)
        chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'vote',
                [types.uint(1), types.bool(true)],
                voter1.address
            ),
            Tx.contractCall(
                'content-moderation',
                'vote',
                [types.uint(1), types.bool(true)],
                voter2.address
            ),
            Tx.contractCall(
                'content-moderation',
                'vote',
                [types.uint(1), types.bool(false)],
                voter3.address
            )
        ]);

        // Try to finalize during voting period (should fail)
        let block = chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'finalize-moderation',
                [types.uint(1)],
                deployer.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u1)'); // ERR-NOT-AUTHORIZED

        // Fast forward blocks to end voting period
        const votingPeriod = 144; // VOTING_PERIOD constant
        for (let i = 0; i < votingPeriod; i++)
        {
            chain.mineEmptyBlock();
        }

        // Now finalize moderation
        block = chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'finalize-moderation',
                [types.uint(1)],
                deployer.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Verify content status is "approved" (more votes for than against)
        const contentCheck = chain.callReadOnlyFn(
            'content-moderation',
            'get-content',
            [types.uint(1)],
            deployer.address
        );

        const contentString = contentCheck.result.replace('(some ', '').slice(0, -1);
        assertEquals(contentString.includes('status: "approved"'), true);

        // Submit another content and test rejection
        chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'submit-content',
                [types.buff("0x636f6e74656e7420746f2062652072656a6563746564")],
                author.address
            )
        ]);

        // Vote on content (1 for, 2 against)
        chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'vote',
                [types.uint(2), types.bool(true)],
                voter1.address
            ),
            Tx.contractCall(
                'content-moderation',
                'vote',
                [types.uint(2), types.bool(false)],
                voter2.address
            ),
            Tx.contractCall(
                'content-moderation',
                'vote',
                [types.uint(2), types.bool(false)],
                voter3.address
            )
        ]);

        // Fast forward blocks to end voting period
        for (let i = 0; i < votingPeriod; i++)
        {
            chain.mineEmptyBlock();
        }

        // Finalize moderation
        block = chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'finalize-moderation',
                [types.uint(2)],
                deployer.address
            )
        ]);

        // Verify content status is "rejected"
        const rejectedContent = chain.callReadOnlyFn(
            'content-moderation',
            'get-content',
            [types.uint(2)],
            deployer.address
        );

        const rejectedString = rejectedContent.result.replace('(some ', '').slice(0, -1);
        assertEquals(rejectedString.includes('status: "rejected"'), true);
    },
});

Clarinet.test({
    name: "Test moderator staking and unstaking",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const moderator = accounts.get('wallet_1')!;

        // Stake tokens to become a moderator
        const stakeAmount = 5000000; // 5 STX (higher than MIN_STAKE_AMOUNT)
        let block = chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'stake-tokens',
                [types.uint(stakeAmount)],
                moderator.address
            )
        ]);

        // Check if staking was successful
        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Verify stake details
        const stakeCheck = chain.callReadOnlyFn(
            'content-moderation',
            'get-moderator-stake',
            [types.principal(moderator.address)],
            deployer.address
        );

        const stakeString = stakeCheck.result.replace('(some ', '').slice(0, -1);
        assertEquals(stakeString.includes(`amount: u${stakeAmount}`), true);
        assertEquals(stakeString.includes('active: true'), true);

        // Try to stake again while already staked (should fail)
        block = chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'stake-tokens',
                [types.uint(stakeAmount)],
                moderator.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u6)'); // ERR-ALREADY-STAKED

        // Try to unstake before lockup period (should fail)
        block = chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'unstake-tokens',
                [],
                moderator.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u1)'); // ERR-NOT-AUTHORIZED

        // Fast forward to end of lockup period
        const lockupPeriod = 720; // STAKE_LOCKUP_PERIOD constant
        for (let i = 0; i < lockupPeriod; i++)
        {
            chain.mineEmptyBlock();
        }

        // Now unstake
        block = chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'unstake-tokens',
                [],
                moderator.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Verify stake was removed
        const updatedStake = chain.callReadOnlyFn(
            'content-moderation',
            'get-moderator-stake',
            [types.principal(moderator.address)],
            deployer.address
        );

        const updatedStakeString = updatedStake.result.replace('(some ', '').slice(0, -1);
        assertEquals(updatedStakeString.includes('amount: u0'), true);
        assertEquals(updatedStakeString.includes('active: false'), true);

        // Try to unstake again (should fail)
        block = chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'unstake-tokens',
                [],
                moderator.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u7)'); // ERR-NO-STAKE-FOUND
    },
});

Clarinet.test({
    name: "Test content reporting system",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const author = accounts.get('wallet_1')!;
        const reporter1 = accounts.get('wallet_2')!;
        const reporter2 = accounts.get('wallet_3')!;
        const reporter3 = accounts.get('wallet_4')!;

        // Initialize reporter reputations
        chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'initialize-reputation',
                [types.principal(reporter1.address), types.uint(150)],
                deployer.address
            ),
            Tx.contractCall(
                'content-moderation',
                'initialize-reputation',
                [types.principal(reporter2.address), types.uint(150)],
                deployer.address
            ),
            Tx.contractCall(
                'content-moderation',
                'initialize-reputation',
                [types.principal(reporter3.address), types.uint(150)],
                deployer.address
            )
        ]);

        // Submit content
        chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'submit-content',
                [types.buff("0x7265706f727461626c6520636f6e74656e742068617368")],
                author.address
            )
        ]);

        // Report content
        let block = chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'report-content',
                [
                    types.uint(1),
                    types.ascii("Inappropriate content")
                ],
                reporter1.address
            )
        ]);

        // Check if report was successful
        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Verify report details
        const reportCheck = chain.callReadOnlyFn(
            'content-moderation',
            'get-content-reports',
            [types.uint(1)],
            deployer.address
        );

        const reportString = reportCheck.result.replace('(some ', '').slice(0, -1);
        assertEquals(reportString.includes('report-count: u1'), true);
        assertEquals(reportString.includes('resolved: false'), true);

        // Another user reports the same content
        block = chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'report-content',
                [
                    types.uint(1),
                    types.ascii("Violates guidelines")
                ],
                reporter2.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Verify report count increased
        const updatedReport = chain.callReadOnlyFn(
            'content-moderation',
            'get-content-reports',
            [types.uint(1)],
            deployer.address
        );

        const updatedReportString = updatedReport.result.replace('(some ', '').slice(0, -1);
        assertEquals(updatedReportString.includes('report-count: u2'), true);

        // Third user reports, reaching threshold
        block = chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'report-content',
                [
                    types.uint(1),
                    types.ascii("Harmful content")
                ],
                reporter3.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Verify content is automatically flagged for moderation
        const contentCheck = chain.callReadOnlyFn(
            'content-moderation',
            'get-content',
            [types.uint(1)],
            deployer.address
        );

        const contentString = contentCheck.result.replace('(some ', '').slice(0, -1);
        assertEquals(contentString.includes('status: "under_review"'), true);

        // Try to report again (should fail)
        block = chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'report-content',
                [
                    types.uint(1),
                    types.ascii("Another reason")
                ],
                reporter1.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u9)'); // ERR-INVALID-REPORT
    },
});

Clarinet.test({
    name: "Test content challenging system",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const author = accounts.get('wallet_1')!;
        const moderator = accounts.get('wallet_2')!;
        const challenger = accounts.get('wallet_3')!;

        // Initialize reputations and stake for moderator
        chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'initialize-reputation',
                [types.principal(moderator.address), types.uint(300)],
                deployer.address
            ),
            Tx.contractCall(
                'content-moderation',
                'initialize-reputation',
                [types.principal(challenger.address), types.uint(200)],
                deployer.address
            ),
            Tx.contractCall(
                'content-moderation',
                'stake-tokens',
                [types.uint(5000000)], // 5 STX
                moderator.address
            )
        ]);

        // Submit content
        chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'submit-content',
                [types.buff("0x6368616c6c656e676561626c6520636f6e74656e742068617368")],
                author.address
            )
        ]);

        // Vote to reject (by moderator)
        chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'vote',
                [types.uint(1), types.bool(false)],
                moderator.address
            )
        ]);

        // Fast forward to end voting period
        const votingPeriod = 144;
        for (let i = 0; i < votingPeriod; i++)
        {
            chain.mineEmptyBlock();
        }

        // Finalize moderation (content rejected)
        chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'finalize-moderation',
                [types.uint(1)],
                deployer.address
            )
        ]);

        // Challenge moderation decision
        const challengeStake = 2000000; // 2 STX
        let block = chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'challenge-moderation',
                [
                    types.uint(1),
                    types.uint(challengeStake),
                    types.ascii("This content doesn't violate guidelines")
                ],
                challenger.address
            )
        ]);

        // Check if challenge was successful
        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Verify challenge details
        const challengeCheck = chain.callReadOnlyFn(
            'content-moderation',
            'get-content-challenge',
            [types.uint(1), types.principal(challenger.address)],
            deployer.address
        );

        const challengeString = challengeCheck.result.replace('(some ', '').slice(0, -1);
        assertEquals(challengeString.includes(`stake-amount: u${challengeStake}`), true);
        assertEquals(challengeString.includes('resolved: false'), true);
        assertEquals(challengeString.includes('successful: false'), true);

        // Vote on challenge (moderators vote to uphold or reverse)
        block = chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'vote-on-challenge',
                [types.uint(1), types.principal(challenger.address), types.bool(true)], // Agree with challenger
                moderator.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Finalize challenge (needs to be called by admin or trusted role)
        block = chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'finalize-challenge',
                [types.uint(1), types.principal(challenger.address)],
                deployer.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Verify content status was updated and challenge was successful
        const contentCheck = chain.callReadOnlyFn(
            'content-moderation',
            'get-content',
            [types.uint(1)],
            deployer.address
        );

        const contentString = contentCheck.result.replace('(some ', '').slice(0, -1);
        assertEquals(contentString.includes('status: "approved"'), true); // Status flipped from rejected to approved

        const finalChallenge = chain.callReadOnlyFn(
            'content-moderation',
            'get-content-challenge',
            [types.uint(1), types.principal(challenger.address)],
            deployer.address
        );

        const finalChallengeString = finalChallenge.result.replace('(some ', '').slice(0, -1);
        assertEquals(finalChallengeString.includes('resolved: true'), true);
        assertEquals(finalChallengeString.includes('successful: true'), true);
    },
});

Clarinet.test({
    name: "Test user cooldown system",
    async fn(chain: Chain, accounts: Map<string, Account>)
    {
        const deployer = accounts.get('deployer')!;
        const author = accounts.get('wallet_1')!;
        const moderator = accounts.get('wallet_2')!;

        // Initialize moderator reputation
        chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'initialize-reputation',
                [types.principal(moderator.address), types.uint(200)],
                deployer.address
            )
        ]);

        // Submit initial content
        chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'submit-content',
                [types.buff("0x666972737420636f6e74656e742068617368")],
                author.address
            )
        ]);

        // Reject content
        chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'vote',
                [types.uint(1), types.bool(false)],
                moderator.address
            )
        ]);

        // Fast forward to end voting period
        const votingPeriod = 144;
        for (let i = 0; i < votingPeriod; i++)
        {
            chain.mineEmptyBlock();
        }

        // Finalize moderation
        chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'finalize-moderation',
                [types.uint(1)],
                deployer.address
            )
        ]);

        // Apply cooldown to author
        let block = chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'apply-cooldown',
                [types.principal(author.address)],
                deployer.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok true)');

        // Verify cooldown status
        const cooldownCheck = chain.callReadOnlyFn(
            'content-moderation',
            'get-user-cooldown',
            [types.principal(author.address)],
            deployer.address
        );

        const cooldownString = cooldownCheck.result.replace('(some ', '').slice(0, -1);
        assertEquals(cooldownString.includes('cooldown-until: u'), true);

        // Try to submit content during cooldown (should fail)
        block = chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'submit-content',
                [types.buff("0x636f6e74656e74206475726e696720636f6f6c646f776e")],
                author.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(err u8)'); // ERR-COOLDOWN-ACTIVE

        // Fast forward past cooldown period
        const cooldownPeriod = 72; // COOLDOWN_PERIOD constant
        for (let i = 0; i < cooldownPeriod; i++)
        {
            chain.mineEmptyBlock();
        }

        // Now should be able to submit
        block = chain.mineBlock([
            Tx.contractCall(
                'content-moderation',
                'submit-content',
                [types.buff("0x6166746572206f6f6c646f776e20636f6e74656e742068617368")],
                author.address
            )
        ]);

        assertEquals(block.receipts.length, 1);
        assertEquals(block.receipts[0].result, '(ok u2)'); // Second content ID
    },
});