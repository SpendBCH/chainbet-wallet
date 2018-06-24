import React, { Component } from 'react';

class Bet extends Component {
  renderBetProps = () => {
      return Object.keys(this.props.bet).map((key) => {
          return (
          <div key={key}>
            <b>{key}</b> { this.props.bet[key] instanceof Buffer ? this.props.bet[key].toString('hex') : 
              this.props.bet[key] === true ? "true" : this.props.bet[key] === false ? "false" : this.props.bet[key] }
          </div>
          );
      })
  }

  renderAcceptBet = () => {
    return <button onClick={ () => this.props.acceptBet(this.props.bet.txId) }>Accept Bet</button>
  }

  renderOffer = (offer) => {
    return (<div>
      <button onClick={ () => this.props.acceptOffer(this.props.bet.txId, offer.clientTxId) }>Accept Offer {offer.clientTxId}</button>
      <br/>
      </div>);
  }

  renderOffers = () => {
    let offers = this.props.bet.offers.map(this.renderOffer)

    return (<div>
      <div>
        <h3>Offers:</h3>
        { offers }
      </div>
      <br />
      </div>);
  }

  render() {
    return (
      <div>
        <div>
            { this.renderBetProps() }
        </div>
        <div>
            { this.props.bet.isActive == false && this.props.bet.phase == 1 ? this.renderAcceptBet() : "" }
        </div>
        <div>
            { this.props.bet.phase == 2 ? this.renderOffers() : "" }
        </div>
        <hr/>
      </div>
    );
  }
}

export default Bet;
