// @ts-check
import { ACCURACY, EPSILON, delayUpdate, createIntInput, createFloatInput, NamedElement } from './util.js'
import { MetaProduct, NoFactoryProduct } from './production.js'
import { NoFactoryNeed, PopulationNeed, PublicBuildingNeed } from './consumption.js'

var ko = require( "knockout" );

export class ResidenceBuilding extends NamedElement {
    constructor(config, assetsMap, island) {
        super(config);
        this.island = island;

        this.region = assetsMap.get(config.region)

        this.existingBuildings = createIntInput(0, 0);
        this.lockDLCIfSet(this.existingBuildings);
        this.limit = createIntInput(0, 0);
        this.limitLowerBound = config.residentMax;
        this.limitPerHouse = createFloatInput(this.limitLowerBound, this.limitLowerBound, Infinity, (newLimit) => Math.max(newLimit, this.limitLowerBound));
        this.residentsPerNeed = new Map();
        for (var guid in config.residentsPerNeed)
            this.residentsPerNeed.set(parseInt(guid), config.residentsPerNeed[guid]);

        this.fixLimitPerHouse = ko.observable(true);

        var inRange = function (buildings, perHouse, val) {
            return val <= buildings * perHouse && val > (buildings - 1) * perHouse;
        }

        this.existingBuildings.subscribe(val => {
            if (this.fixLimitPerHouse()) {
                this.limit(Math.floor(val * this.limitPerHouse()));
            } else {
                var perHouse = this.limit() / val;
                if (Math.abs(this.limitPerHouse() - perHouse) > ACCURACY)
                    this.limitPerHouse(perHouse);
            }
        });

        this.limit.subscribe(val => {
            if (this.fixLimitPerHouse() && !inRange(this.existingBuildings(), this.limitPerHouse(), this.limit()))
                this.existingBuildings(Math.ceil(val / this.limitPerHouse()));
            else {
                var perHouse = val / (this.existingBuildings() || 1);

                if (Math.abs(this.limitPerHouse() - perHouse) > ACCURACY)
                    if (perHouse < this.limitLowerBound)
                        this.existingBuildings(Math.floor(val / this.limitLowerBound));
                    else if (this.existingBuildings() >= 1)
                        this.limitPerHouse(perHouse);
            }
        });

        this.limitPerHouse.subscribe(val => {
            this.limit(val * this.existingBuildings());
        });

    }

    handleBonusNeed(need) {
        if (!this.residentsPerNeed.has(need.guid))
            return;

        need.available.subscribe(checked => {
            var inc = (checked ? 1 : -1) * this.residentsPerNeed.get(need.guid);
            this.limitLowerBound += inc;
            var lpH = this.limitPerHouse() + inc;
            this.limitPerHouse(lpH);

            if (this.populationLevel.allResidences.length == 0 ||
                this.populationLevel.existingBuildings() == 0 && this.populationLevel.residence == this)

                this.populationLevel.limitPerHouse(lpH);
        });

        if (need.available()) {
            var inc = this.residentsPerNeed.get(need.guid);
            this.limitLowerBound += inc;
            this.limitPerHouse(this.limitPerHouse() + inc);

            if (this.populationLevel.allResidences.length == 0 ||
                this.populationLevel.existingBuildings() == 0 && this.populationLevel.residence == this)

                this.populationLevel.limitPerHouse(this.limitPerHouse());
        }
    }

    getNoConsumptionResidents() {
        var residents = 0;

        for (var [guid, res] of this.residentsPerNeed) {
            var need = this.populationLevel.needsMap.get(guid);
            if (need && need.available() &&
                need.excludePopulationFromMoneyAndConsumptionCalculation &&
                (need.requiredBuildings == null || need.requiredBuildings.indexOf(this.guid) != -1))
                residents += res;
        }

        return residents * this.existingBuildings();
    }
}

export class PopulationLevel extends NamedElement {
    constructor(config, assetsMap, island) {
        super(config);
        this.island = island

        this.hotkey = ko.observable(null);

        this.needs = [];
        this.buildingNeeds = [];
        this.basicNeeds = [];
        this.luxuryNeeds = [];
        this.bonusNeeds = [];
        this.needsMap = new Map();
        this.region = assetsMap.get(config.region);

        this.allResidences = [];
        this.notes = ko.observable("");

        if (this.residence) {
            this.residence = assetsMap.get(this.residence);
            this.residence.populationLevel = this;
            this.allResidences.push(this.residence);
        }

        if (config.skyscraperLevels) {
            this.skyscraperLevels = config.skyscraperLevels.map(l => assetsMap.get(l));
            this.skyscraperLevels.forEach(l => l.populationLevel = this);
            this.allResidences = this.allResidences.concat(this.skyscraperLevels);
        }
        if (config.specialResidence) {
            this.specialResidence = assetsMap.get(config.specialResidence);
            this.specialResidence.populationLevel = this;
            this.allResidences.push(this.specialResidence);
        }
        this.availableResidences = ko.pureComputed(() => this.allResidences.filter(r => r.available()))


        this.amount = createIntInput(0, 0);
        this.existingBuildings = createIntInput(0, 0, Infinity, (val) => {
            if (this.getFloorsSummedExistingBuildings && val < this.getFloorsSummedExistingBuildings())
                return this.getFloorsSummedExistingBuildings();

            return val;
        });
        this.limit = createIntInput(0, 0, Infinity, (val) => {
            if (this.getFloorsSummedLimit && val < this.getFloorsSummedLimit())
                return this.getFloorsSummedLimit();

            return val;
        });
        this.amountPerHouse = createFloatInput(config.fullHouse, 1, Infinity, (newVal, current) => {
            if (this.limitPerHouse && this.fixLimitPerHouse && newVal > this.limitPerHouse() + ACCURACY &&
                (this.fixLimitPerHouse() || this.canEditPerHouse && !this.canEditPerHouse()))
                return this.limitPerHouse();

            return newVal;
        });
        this.limitPerHouse = createFloatInput(this.residence.limitPerHouse(), config.fullHouse);

        this.fixAmountPerHouse = ko.observable(true);
        this.fixLimitPerHouse = ko.observable(true);

        var inRange = function (buildings, perHouse, val) {
            return val <= buildings * perHouse && val > (buildings - 1) * perHouse;
        }

        config.needs.forEach(n => {
            var need;
            var product = assetsMap.get(n.guid);

            if (n.tpmin > 0 && product && !(product instanceof MetaProduct)) {
                need = product instanceof NoFactoryProduct ? new NoFactoryNeed(n, this, assetsMap) : new PopulationNeed(n, this, assetsMap);
                this.needs.push(need);
            } else {
                need = new PublicBuildingNeed(n, assetsMap);
                this.buildingNeeds.push(need);
            }

            if (n.isBonusNeed || n.excludePopulationFromMoneyAndConsumptionCalculation) {
                need.checked(false);
                for (var dlc of (need.dlcs || []))
                    dlc.checked.subscribe(checked => {
                        if (!checked)
                            need.checked(false);
                    });

                this.bonusNeeds.push(need);
                this.needsMap.set(need.guid, need);
                this.allResidences.forEach(r => r.handleBonusNeed(need));
                return;
            }

            if (n.residents || n.requiredFloorLevel)
                this.basicNeeds.push(need);
            else
                this.luxuryNeeds.push(need);
            this.needsMap.set(need.guid, need);
        });



        this.hasBonusNeeds = ko.pureComputed(() => {
            for (var n of this.bonusNeeds || [])
                if (!n.hidden())
                    return true;

            return false;
        });

        this.amount.subscribe(val => {

            if (this.limit() < val && (!this.hasSkyscrapers || !this.hasSkyscrapers()))
                this.limit(val);

            if (this.fixAmountPerHouse())
                this.existingBuildings(Math.ceil(val / this.amountPerHouse() - EPSILON));
            else {
                var perHouse = val / (this.existingBuildings() || 1);

                if (Math.abs(this.amountPerHouse() - perHouse) > ACCURACY)
                    if (this.fixLimitPerHouse() && perHouse > ACCURACY + this.limitPerHouse()) {
                        this.existingBuildings(Math.ceil(val / this.limitPerHouse() - EPSILON));
                        delayUpdate(this.amount, val);
                        return;
                    } else if (this.existingBuildings() >= 1)
                        this.amountPerHouse(perHouse);
            }
        });

        this.amountPerHouse.subscribe(val => {
            if (val > this.limitPerHouse() + ACCURACY) {
                if (this.fixLimitPerHouse() || (this.canEditPerHouse && !this.canEditPerHouse())) {
                    this.amountPerHouse(this.limitPerHouse());
                    return;
                } else {
                    this.limitPerHouse(val);
                }
            }

            if (view.settings.deriveResidentsPerHouse.checked() || !inRange(this.existingBuildings(), val, this.amount()))
                this.amount(val * this.existingBuildings());
        });

        if (this.skyscraperLevels || this.specialResidence) {
            // ensure that the value for the population level and those summed over the buildings match
            // the observables are only used for change propagation, the up-to-date values are available via the functions
            this.getFloorsSummedExistingBuildings = () => {
                var specialResidence = this.specialResidence ? this.specialResidence.existingBuildings() : 0;
                var levelSum = this.skyscraperLevels ? this.skyscraperLevels.map(s => s.existingBuildings()).reduce((a, b) => a + b) : 0;
                return specialResidence + levelSum;
            };
            this.floorsSummedExistingBuildings = ko.computed(() => this.getFloorsSummedExistingBuildings());

            this.getFloorsSummedLimit = () => {
                var specialResidence = this.specialResidence ? this.specialResidence.limit() : 0;
                var levelSum = this.skyscraperLevels ? this.skyscraperLevels.map(s => s.limit()).reduce((a, b) => a + b) : 0;
                return specialResidence + levelSum;
            };
            this.floorsSummedLimit = ko.computed(() => this.getFloorsSummedLimit());

            this.floorsSummedExistingBuildings.subscribe(val => {
                if (val > 0) {
                    view.settings.deriveResidentsPerHouse.checked(false);
                    this.fixLimitPerHouse(false);
                }
            });

            this.hasSkyscrapers = () => this.getFloorsSummedExistingBuildings() || this.getFloorsSummedLimit();

            this.fixLimitPerHouse.subscribe(fixed => {
                this.residence.fixLimitPerHouse(fixed || this.hasSkyscrapers())
            })

            this.floorsSummedExistingBuildings.subscribe(val => {
                this.existingBuildings(val + this.residence.existingBuildings());
            });
            this.existingBuildings.subscribe(val => {
                if (val < this.getFloorsSummedExistingBuildings()) {
                    return;
                }
                else
                    this.residence.existingBuildings(Math.max(0, val - this.getFloorsSummedExistingBuildings()));

                if (this.hasSkyscrapers() && !this.fixLimitPerHouse()) {
                    var perHouse = this.limit() / val;
                    if (Math.abs(this.limitPerHouse() - perHouse) > ACCURACY)
                        this.limitPerHouse(perHouse);

                }

                if (this.fixAmountPerHouse()) {
                    if (!inRange(val, this.amountPerHouse(), this.amount()))
                        this.amount(Math.floor(val * this.amountPerHouse()));
                } else {
                    var perHouse = this.amount() / val;
                    if (perHouse < 1) {
                        this.amount(val);
                        perHouse = 1;
                    }
                    if (Math.abs(this.amountPerHouse() - perHouse) > ACCURACY)
                        this.amountPerHouse(perHouse);
                }
            });
            this.residence.existingBuildings.subscribe(val => {
                this.existingBuildings(val + this.getFloorsSummedExistingBuildings());
            });

            this.floorsSummedLimit.subscribe(val => {
                this.limit(val + this.residence.limit());
            });
            this.limit.subscribe(val => {
                if (val < this.getFloorsSummedLimit()) {
                    return;
                }
                else
                    this.residence.limit(Math.max(0, val - this.getFloorsSummedLimit()));

                if (this.amount() > val)
                    this.amount(val);

                if (this.existingBuildings() >= 1) {
                    var perHouse = val / this.existingBuildings();
                    var perHouseCapped = Math.max(this.residence.limitLowerBound, perHouse);

                    if (Math.abs(this.limitPerHouse() - perHouse) > ACCURACY)
                        this.limitPerHouse(perHouseCapped);
                }
            });
            this.residence.limit.subscribe(val => {
                this.limit(val + this.getFloorsSummedLimit());
            });
            this.limitPerHouse.subscribe(val => {
                if (val + ACCURACY < this.amountPerHouse()) {
                    this.amountPerHouse(val);
                }
            });

            this.canEditPerHouse = ko.pureComputed(() => {
                return !this.hasSkyscrapers() && !(this.specialResidence && this.specialResidence.existingBuildings());
            });
        } else {
            this.hasSkyscrapers = () => false;

            this.existingBuildings.subscribe(val => {

                if (this.fixLimitPerHouse()) {
                    if (!inRange(val, this.limitPerHouse(), this.limit()))
                        this.limit(Math.floor(val * this.limitPerHouse()));
                } else {
                    var perHouse = this.limit() / val;
                    if (Math.abs(this.limitPerHouse() - perHouse) > ACCURACY)
                        this.limitPerHouse(perHouse);
                }

                if (this.fixAmountPerHouse()) {
                    if (!inRange(val, this.amountPerHouse(), this.amount()))
                        this.amount(Math.floor(val * this.amountPerHouse()));
                } else {
                    var perHouse = this.amount() / val;
                    if (Math.abs(this.amountPerHouse() - perHouse) > ACCURACY)
                        this.amountPerHouse(perHouse);
                }
            });

            this.limit.subscribe(val => {
                if (this.amount() > val)
                    this.amount(val);

                if (this.fixLimitPerHouse() && !inRange(this.existingBuildings(), this.limitPerHouse(), this.limit()))
                    this.existingBuildings(Math.ceil(val / this.limitPerHouse()));
                else {
                    var perHouse = val / (this.existingBuildings() || 1);
                    var perHouseCapped = Math.max(this.fullHouse, perHouse);

                    if (Math.abs(this.limitPerHouse() - perHouse) > ACCURACY)
                        if (this.fixAmountPerHouse() && perHouseCapped + ACCURACY < this.amountPerHouse()) {
                            this.existingBuildings(Math.ceil(val / this.amountPerHouse()));
                            delayUpdate(this.limit, val);
                            return;
                        } else if (perHouse < this.residence.limitLowerBound)
                            this.existingBuildings(Math.floor(val / this.residence.limitLowerBound));
                        else if (this.existingBuildings() >= 1)
                            this.limitPerHouse(perHouse);
                }
            });



            this.limitPerHouse.subscribe(val => {
                if (val + ACCURACY < this.amountPerHouse()) {
                    this.amountPerHouse(val);
                }

                if (!inRange(this.existingBuildings(), val, this.limit()))
                    this.limit(val * this.existingBuildings());
            });

            this.existingBuildings.subscribe(val => this.residence.existingBuildings(val));
            this.limit.subscribe(val => this.residence.limit(val));
            this.limitPerHouse.subscribe(val => this.residence.limitPerHouse(val));
            this.fixLimitPerHouse.subscribe(val => this.residence.fixLimitPerHouse(val));

            // Does not work because lambda uses the last value of local variable:
            //for (var attr of ["existingBuildings", "limit", "limitPerHouse", "fixLimitPerHouse"])
            //    this[attr].subscribe(val => this.residence[attr](val));

            this.canEditPerHouse = ko.pureComputed(() => {
                return true;
            });
        }

        this.visible = ko.pureComputed(() => {
            if (!this.available())
                return false;

            if (!view.island || !view.island())
                return true;

            var region = view.island().region;
            if (!region)
                return true;

            return this.region === region;
        });
    }

    initBans(assetsMap) {
        for (var n of this.needs.concat(this.buildingNeeds))
            n.initBans(this, assetsMap);
        this.deriveResidentsPerHouse = ko.computed(() => {
            if (!view.settings.deriveResidentsPerHouse.checked() || this.getFloorsSummedExistingBuildings && this.hasSkyscrapers())
                return;

            if (!this.fixAmountPerHouse())
                this.fixAmountPerHouse(true);

            var perHouse = 0;
            for (var need of this.basicNeeds.concat(this.bonusNeeds))
                if (!need.requiredFloorLevel &&
                    (need.requiredBuildings == null || need.requiredBuildings.indexOf(this.residence.guid) !== -1) &&
                    (!need.banned || !need.banned()) &&
                    (!need.visible || need.visible()))

                    perHouse += need.residents;

            this.amountPerHouse(perHouse);
        });

    }

    getNoConsumptionResidents() {
        var residents = 0;
        for (var r of this.allResidences)
            residents += r.getNoConsumptionResidents();

        return residents;
    }

    incrementAmount() {
        this.amount(parseFloat(this.amount()) + 1);
    }

    decrementAmount() {
        this.amount(parseFloat(this.amount()) - 1);
    }

    applyConfigGlobally() {
        var affectingItems = new Set();
        for (var u of this.island.allGoodConsumptionUpgrades.upgrades)
            if (u.populationLevels.indexOf(this) != -1)
                affectingItems.add(u);

        for (var isl of view.islands()) {
            if (this.region && isl.region && this.region != isl.region)
                continue;

            var other = isl.assetsMap.get(this.guid);

            for (var i of affectingItems)
                if (isl.assetsMap.has(i.guid))
                    isl.assetsMap.get(i.guid).checked(i.checked());

            for (var i = 0; i < this.needs.length; i++) {
                other.needs[i].checked(this.needs[i].checked());
                other.needs[i].percentBoost(this.needs[i].percentBoost());
            }

            for (var i = 0; i < this.buildingNeeds.length; i++)
                other.buildingNeeds[i].checked(this.buildingNeeds[i].checked());

            other.amountPerHouse(this.amountPerHouse());
            other.limitPerHouse(this.limitPerHouse());
            other.fixAmountPerHouse(true);
            other.fixLimitPerHouse(true);

            if (this.residence && other.residence) {
                other.residence.limitPerHouse(this.residence.limitPerHouse());
                other.residence.fixLimitPerHouse(true);
            }

            if (this.skyscraperLevels && other.skyscraperLevels) {
                other.skyscraperLevels.limitPerHouse(this.skyscraperLevels.limitPerHouse());
                other.skyscraperLevels.fixLimitPerHouse(true);
            }

            if (this.specialResidence && other.specialResidence) {
                other.specialResidence.limitPerHouse(this.specialResidence.limitPerHouse());
            }
        }
    }
}

export class CommuterWorkforce extends NamedElement {
    constructor(config, session) {
        super(config);

        this.session = session;

        this.amount = ko.pureComputed(() => {
            var amount = 0;

            for (var isl of this.session.islands()) {
                if (isl.commuterPier.checked())
                    amount += isl.assetsMap.get(this.guid).amount();
            }

            return amount;
        });

        this.visible = ko.pureComputed(() => {
            if (!this.available())
                return false;

            return this.amount() != 0;
        });
    }
}

export class Workforce extends NamedElement {
    constructor(config, assetsMap) {
        super(config);
        this.amount = ko.observable(0);
        this.demands = [];

        this.visible = ko.pureComputed(() => {
            if (!this.available())
                return false;

            return this.amount() != 0;
        });
    }

    updateAmount() {
        var sum = 0;
        this.demands.forEach(d => sum += d.workforce() == this ? d.amount() : 0);
        this.amount(sum);
    }

    add(demand) {
        this.demands.push(demand);
    }
}

export class WorkforceDemand extends NamedElement {
    constructor(config, assetsMap) {
        super(config);
        this.buildings = 0;

        this.amount = ko.observable(0);
        this.percentBoost = createIntInput(100, 0);
        this.percentBoost.subscribe(val => {
            this.updateAmount(this.buildings);
        });

        this.workforce = ko.observable(config.workforce);
        this.workforce().add(this);

        this.amount.subscribe(val => this.workforce().updateAmount());
    }

    updateAmount(buildings) {
        this.buildings = buildings;

        var perBuilding = Math.ceil(this.Amount * this.percentBoost() / 100);
        this.amount(Math.ceil(buildings) * perBuilding);
    }
}

export class WorkforceDemandSwitch extends WorkforceDemand {
    constructor(config, item, assetsMap) {
        super(config, assetsMap);
        this.isSwitch = true;
        this.item = item;
        this.defaultWorkforce = this.workforce();
        this.replacingWorkforce = this.item.replacingWorkforce;

        this.replacingWorkforce.add(this);

        this.item.checked.subscribe(checked => {
            this.workforce(checked ? this.replacingWorkforce : this.defaultWorkforce);
            this.defaultWorkforce.updateAmount();
            this.replacingWorkforce.updateAmount();
        });
    }
}
