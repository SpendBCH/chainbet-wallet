import React, { Component } from 'react';
import './App.css';
import Bet from './Bet'
import Wallet from './Wallet'

class App extends Component {
  constructor(props) {
    super(props)

    this.state = { 
      bets: [],
      wallet: null,
     }
  }

  announceBet = () => {
    this.state.wallet.announceBet(2000)
  }

  acceptBet = (betTxId) => {
    this.state.wallet.acceptBet(betTxId)
  }

  acceptOffer = (betTxId, clientTxId) => {
    this.state.wallet.acceptOffer(betTxId, clientTxId)
  }

  setWallet = (wallet) => {
    wallet.listen((bets) => { 
      this.setState({ bets: bets })
    })

    this.setState({ wallet: wallet })
  }

  renderBet = (bet) => {
    return <Bet key={bet.txId} bet={bet} acceptBet={ this.acceptBet } acceptOffer={ this.acceptOffer } />
  }

  renderBets = () => {
    let availableBets = this.state.bets.filter((bet) => bet.isHost == false && bet.isActive == false && bet.phase == 1)
      .map(this.renderBet)

    let activeBets = this.state.bets.filter((bet) => bet.isActive)
      .map(this.renderBet)

    return (<div>
      <div>
        <h1>Available bets:</h1>
        { availableBets }
      </div>
      <div>
        <h1>Active bets:</h1>
        { activeBets }
      </div>
      <br />
      </div>);
  }

  render() {
    return (
      <div className="App">
        <h1>Chainbet Wallet</h1>
        <div>
          <Wallet wallet={this.state.wallet} setWallet={this.setWallet} announceBet={this.announceBet} />
        </div>
        { (this.state.wallet) ? this.renderBets() : "" }
      </div>
    );
  }
}

export default App;
