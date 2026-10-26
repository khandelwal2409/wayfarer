export function annualTotals(trips) {
  return trips.reduce((totals, trip) => {
    totals.hotel_paise += Number(trip.hotel_total_paise);
    totals.food_paise += Number(trip.food_total_paise);
    totals.fuel_paise += Number(trip.fuel_total_paise);
    totals.transport_paise += Number(trip.transport_total_paise);
    totals.other_paise += Number(trip.other_total_paise);
    totals.total_paise += Number(trip.total_paise);
    return totals;
  }, { hotel_paise: 0, food_paise: 0, fuel_paise: 0, transport_paise: 0, other_paise: 0, total_paise: 0 });
}
