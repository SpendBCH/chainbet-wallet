let BITBOXCli = require('bitbox-cli/lib/bitbox-cli').default;
let BITBOX = new BITBOXCli();
const cbtx = require('./transactions')

class Bet {
    constructor(txId, amount, type, targetAddress, isHost) {
        this.phase = isHost ? 1 : 2
        this.isHost = isHost
        this.isActive = true

        // Phase 1 data
        this.txId = txId
        this.amount = amount
        this.type = type
        this.targetAddress = targetAddress

        // Phase 2 data
        this.participantPubKey
        this.participantCommitment

        // Phase 3 data
        this.participantTxId
        this.hostEscrowTxId
        this.hostPubKey

        // Phase 4 data
        this.participantEscrowTxId
        this.participantSignature1
        this.participantSignature2

        // Phase 6 data
        this.participantSecret
    }
}

module.exports = class ChainbetWallet {
    constructor(wallet) {
        // TODO: Derive pubKey and address from wif
        // TODO: Optional create new wallet

        this.wallet = wallet
        this.bets = []
        this.listeners = []

        this.monitorBets()
    }

    listen(listener) {
        listeners.push(listener)
    }

    // TODO: Push event for each action
    publishEvent(data) {
        listeners.forEach(listener => listener(data))
    }

    // TODO: Monitor bets on blockchain to claim purse after win
    monitorBets() {

    }

    async announceBet(amount, targetAddress, type = 0x01) {
        let betTxId = await cbtx.sendMessagePhase1(this.wallet, type, amount, targetAddress)
        let bet = new Bet(betTxId, amount, type, targetAddress, true)
        this.bets.push(bet)
    }
    
    async acceptBet(betMessage, txId) {
        let bet = new Bet(txId, betMessage.amount, betMessage.type, 
            betMessage.targetAddress, false)

        bet.participantSecret = BITBOX.Crypto.randomBytes(32)
        bet.participantCommitment = BITBOX.Crypto.hash160(bet.participantSecret)

        bet.participantTxId = await cbtx.sendMessagePhase2(this.wallet, txId, this.wallet.pubKey, bet.participantCommitment)

        this.bets.push(bet)
    }    

    async processBetMessage(betMessage, txId, sender) {
        if (sender == this.wallet.address) return;

        // Verify this is an active bet the user is watching
        let bet = this.bets.find((b) => b.isActive == true && b.txid == betMessage.betTxid)
        if (bet === undefined) return

        // TODO: Verify phase is in sync

        // TODO: Verify sender address matches host/participant

        // Phase 3 Bet Host Funding
        if (betMessage.phase == 2) {
            bet.participantPubKey = betMessage.multisigPubKey
            bet.participantCommitment = betMessage.participantCommitment

            bet.hostSecret = BITBOX.Crypto.randomBytes(32)
            bet.hostCommitment = BITBOX.Crypto.hash160(bet.hostSecret)

            let multisigPubKeys = [this.wallet.pubKey, bet.participantPubKey]
            bet.hostEscrowTxId = await cbtx.fundHostEscrow(this.wallet, multisigPubKeys, bet.amount, bet.hostCommitment)

            bet.participantTxId = txId
            await cbtx.sendMessagePhase3(this.wallet, bet.txId, bet.participantTxId, bet.hostEscrowTxId, this.wallet.pubKey)
        }
        // Phase 4 Bet Participant Funding
        else if (betMessage.phase == 3) {
            // TODO: Verify alice's escrow

            bet.participantEscrowTxid = await cbtx.fundParticipantEscrow(this.wallet, multisigPubKeys, bet.amount)
            
            let multisigPubKeys = [this.wallet.pubKey, bet.participantPubKey]
            await cbtx.sendMessagePhase4(this.wallet, multisigPubKeys, bet.participantEscrowTxid, bet.hostCommitment, bet.hostEscrowTxId, bet.betTxId)
        }
        // Phase 5 Funding Transaction
        else if (betMessage.phase == 4) {
            let multisigPubKeys = [this.wallet.pubKey, bet.participantPubKey]
            bet.contractTxId = await cbtx.fundBetContract(this.wallet, multisigPubKeys, bet.amount,
                bet.participantCommitment, bet.hostCommitment, bet.participantEscrowTxid, bet.hostEscrowTxId)
        }
        // Phase 6 Bet Participant Resignation
        else if (betMessage.phase == 6) {
            bet.participantSecret = betMessage.secretValue
            
            await cbtx.claimPurse(this.wallet)
            
            bet.isActive = false
        }
    }
}