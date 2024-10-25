;; Decentralized Content Moderation Contract
;; Allows users to submit content, vote on moderation decisions, and manage reputation

;; Constants
(define-constant ERR-NOT-AUTHORIZED (err u1))
(define-constant ERR-ALREADY-VOTED (err u2))
(define-constant ERR-CONTENT-NOT-FOUND (err u3))
(define-constant ERR-INSUFFICIENT-REPUTATION (err u4))
(define-constant VOTING_PERIOD u144) ;; ~24 hours in blocks
(define-constant MIN_REPUTATION u100)
(define-constant VOTE_REWARD u10)

;; Data Maps
(define-map contents 
    { content-id: uint }
    {
        author: principal,
        content-hash: (buff 32),
        status: (string-ascii 20),
        created-at: uint,
        votes-for: uint,
        votes-against: uint,
        voting-ends-at: uint
    }
)

(define-map user-reputation
    { user: principal }
    { score: uint }
)

(define-map user-votes
    { content-id: uint, voter: principal }
    { vote: bool }
)

;; Variables
(define-data-var content-counter uint u0)

;; Private Functions
(define-private (is-voting-period-active (content-id uint))
    (match (map-get? contents { content-id: content-id })
        content (< block-height (get voting-ends-at content))
        false
    )
)

(define-private (has-sufficient-reputation (user principal))
    (let (
        (reputation (default-to { score: u0 } (map-get? user-reputation { user: user })))
    )
        (>= (get score reputation) MIN_REPUTATION)
    )
)

;; Submit new content for moderation
(define-public (submit-content (content-hash (buff 32)))
    (let (
        (content-id (+ (var-get content-counter) u1))
    )
        (map-set contents
            { content-id: content-id }
            {
                author: tx-sender,
                content-hash: content-hash,
                status: "pending",
                created-at: block-height,
                votes-for: u0,
                votes-against: u0,
                voting-ends-at: (+ block-height VOTING_PERIOD)
            }
        )
        (var-set content-counter content-id)
        (ok content-id)
    )
)