// @ts-check
import { EPSILON, createFloatInput, NamedElement, Option } from './util.js'
import { Demand } from './production.js'

export class Need extends Demand {
    constructor(config, assetsMap) {
        super(config, assetsMap);
        this.isNeed = true;
        this.allDemands = [];

        let treeTraversal = node => {
            if (node instanceof Demand && !(node instanceof Need))
                this.allDemands.push(node);
            (node.demands || []).forEach(treeTraversal);
        }
        treeTraversal(this);
    }

}

export class PublicBuildingNeed extends Option {
    constructor(config, assetsMap) {
        super(config);

        this.checked(true);

        this.product = assetsMap.get(this.guid);
        if (!this.product)
            throw `No Product ${this.guid}`;
        this.initBans = PopulationNeed.prototype.initBans;

        if (this.requiredBuildings) {
            this.residences = this.requiredBuildings.map(r => assetsMap.get(r));
            this.hidden = ko.computed(() => {
                if (!this.available())
                    return true;

                for (var r of this.residences)
                    if (r.existingBuildings() > 0)
                        return false;

                return true;
            });
        } else {
            this.hidden = ko.computed(() => !this.available());
        }
    }
}

export class NoFactoryNeed extends PublicBuildingNeed {
    constructor(config, level, assetsMap) {
        super(config, assetsMap);

        this.isNoFactoryNeed = true;
        this.updateAmount = PopulationNeed.prototype.updateAmount;

        this.amount = ko.observable(0);
        if (this.factor == null)
            this.factor = 1;


        this.allDemands = []; // compatibility with Need

        this.region = level.region;
        this.level = level;
        this.population = 0;

        this.goodConsumptionUpgradeList = new GoodConsumptionUpgradeList(this);

        this.percentBoost = createFloatInput(100, 0);
        this.boost = ko.computed(() => parseInt(this.percentBoost()) / 100);

        this.boost.subscribe(() => this.updateAmount(this.population));
        this.optionalAmount = ko.observable(0);
        this.notes = ko.observable("");

        this.residentsInput = ko.pureComputed(() => {
            return this.amount() * this.residentsInputFactor;
        });

        if (this.requiredBuildings) {
            this.residences = this.requiredBuildings.map(r => assetsMap.get(r));

            this.residencesSubscription = ko.computed(() => {
                var amount = 0;
                this.residences.forEach(r => {
                    amount += r.limit();
                });

                this.updateAmount(amount);
            });

            this.hidden = ko.computed(() => {
                if (!this.available())
                    return true;

                for (var r of this.residences)
                    if (r.existingBuildings() > 0)
                        return false;

                return true;
            });
        } else {
            this.hidden = ko.computed(() => !this.available());
            this.residences = level.allResidences;
            level.limit.subscribe(limit => this.updateAmount(limit));
        }

        this.product.addNeed(this);
    }

    incrementPercentBoost() {
        this.percentBoost(parseInt(this.percentBoost()) + 1);
    }

    decrementPercentBoost() {
        this.percentBoost(parseInt(this.percentBoost()) - 1);
    }
}

export class PopulationNeed extends Need {
    constructor(config, level, assetsMap) {
        super(config, assetsMap);

        this.region = level.region;
        this.level = level;
        this.population = 0;


        this.goodConsumptionUpgradeList = new GoodConsumptionUpgradeList(this);

        this.percentBoost = createFloatInput(100, 0);
        this.boost = ko.computed(() => parseInt(this.percentBoost()) / 100);

        this.boost.subscribe(() => this.updateAmount(this.population));

        this.checked = ko.observable(true);
        this.optionalAmount = ko.observable(0);

        this.notes = ko.observable("");

        if (this.requiredBuildings) {
            this.residences = this.requiredBuildings.map(r => assetsMap.get(r));

            this.residencesSubscription = ko.computed(() => {
                var amount = 0;
                this.residences.forEach(r => {
                    amount += r.limit();
                });

                this.updateAmount(amount);
            });

            this.hidden = ko.computed(() => {
                if (!this.available())
                    return true;

                for (var r of this.residences)
                    if (r.existingBuildings() > 0 || level.residence == r)
                        return false;

                return true;
            });
        } else {
            this.hidden = ko.computed(() => !this.available());
            this.residences = level.allResidences;
            level.limit.subscribe(limit => this.updateAmount(limit));
        }

        // dependency chain: updateAmount -> getNoConsumptionResidents -> existingBuildings
        this.residences.forEach(r => r.existingBuildings.subscribe(() => this.updateAmount(this.population)));
    }

    initBans(level, assetsMap) {
        if (this.unlockCondition) {
            var config = this.unlockCondition;
            this.locked = ko.computed(() => {
                if (!config || !view.settings.needUnlockConditions.checked())
                    return false;

                if (level.skyscraperLevels && level.hasSkyscrapers())
                    return false;

                if (config.populationLevel != level.guid) {
                    var l = assetsMap.get(config.populationLevel);
                    return l.amount() < config.amount;
                }

                if (level.amount() >= config.amount)
                    return false;

                var residence = level.residence.upgradedBuilding;
                while (residence) {
                    var l = residence.populationLevel;
                    var amount = l.amount();
                    if (amount > 0)
                        return false;

                    residence = residence.upgradedBuilding;
                }

                return true;
            });
        }

        this.banned = ko.computed(() => {
            var checked = this.checked();
            var noOptionalNeeds = view.settings.noOptionalNeeds.checked();
            return !checked ||
                this.happiness && noOptionalNeeds ||
                this.locked && this.locked();
        });

        if (this.amount) {
            this.banned.subscribe(banned => {
                if (banned)
                    this.amount(0);
                else
                    this.amount(this.optionalAmount());
            });
            if (this.banned())
                this.amount(0); //bonus needs disabled by default, but amount already set before initializing this.banned

            this.isInactive = ko.computed(() => {
                return this.locked && this.locked() || this.happiness && view.settings.noOptionalNeeds.checked();
            });
        } else {
            // for PublicBuildingNeed
            this.isInactive = ko.computed(() => {
                return this.locked && this.locked();
            });
        }
    }

    updateAmount(population) {
        this.population = population;

        var noConsumption = 0;
        this.residences.forEach(r => {
            noConsumption += r.getNoConsumptionResidents();
        })

        this.optionalAmount(this.tpmin * (population - noConsumption) * this.boost());
        if (!this.banned || !this.banned())
            this.amount(this.optionalAmount());
    }

    incrementPercentBoost() {
        this.percentBoost(parseInt(this.percentBoost()) + 1);
    }

    decrementPercentBoost() {
        this.percentBoost(parseInt(this.percentBoost()) - 1);
    }
}

export class BuildingMaterialsNeed extends Need {
    constructor(config, assetsMap) {
        super(config, assetsMap);

        this.product = config.product;
        this.factory(config.factory);

        this.factory().add(this);
        this.factory().buildingMaterialsNeed = this;
    }

    updateAmount() {
        var otherDemand = 0;
        this.factory().demands.forEach(d => otherDemand += d == this ? 0 : d.amount());

        if (this.factory().tradeList)
            otherDemand += this.factory().tradeList.amount();

        if (this.factory().contractList)
            otherDemand += this.factory().contractList.amount();

        if (this.factory().extraGoodProductionList && this.factory().extraGoodProductionList.checked())
            otherDemand -= this.factory().extraGoodProductionList.amount();

        var existingBuildingsOutput =
            this.factory().existingBuildings() * this.factory().tpmin * this.factory().boost() * this.factory().extraGoodFactor();

        if (this.factory().existingBuildings() === 0)
            otherDemand = Math.max(0, otherDemand);

        var amount = Math.max(0, existingBuildingsOutput - otherDemand - EPSILON);

        if (Math.abs(amount - this.amount()) >= EPSILON)
            this.amount(amount);
    }

    updateFixedProductFactory() { }
}


export class GoodConsumptionUpgrade extends Option {
    constructor(config, assetsMap, levels) {
        super(config, assetsMap);

        this.lockDLCIfSet(this.checked);

        this.entries = [];
        this.entriesMap = new Map();
        this.populationLevels = config.populationLevels.map(l => assetsMap.get(l)).filter(l => !!l);
        if (!this.populationLevels.length)
            return;

        this.populationLevelsSet = new Set(this.populationLevels);

        for (var entry of config.goodConsumptionUpgrade) {
            //if (entry.AmountInPercent <= -100)
            //    continue;

            this.entries.push(new GoodConsumptionUpgradeEntry($.extend({ upgrade: this }, entry), assetsMap));
            this.entriesMap.set(entry.ProvidedNeed, this.entries[this.entries.length - 1]);
        }

        for (var level of levels) {
            if (!this.populationLevelsSet.has(level))
                continue;

            for (var need of level.needs) {
                var entry = this.entriesMap.get(need.product.guid);
                if (entry)
                    need.goodConsumptionUpgradeList.add(entry);
            }
        }

        this.visible = ko.computed(() => {
            if (!this.available())
                return false;

            if (!view.island || !view.island())
                return true;

            var region = view.island().region;
            if (!region)
                return true;

            for (var l of this.populationLevels)
                if (l.region === region)
                    return true;

            return false;
        });
    }
}

export class NewspaperNeedConsumption {
    constructor() {
        this.selectedEffects = ko.observableArray();
        this.allEffects = [];
        this.amount = ko.observable(100);
        this.selectedBuff = ko.observable(0);
        this.selectableBuffs = ko.observableArray();

        this.updateBuff();

        this.selectedEffects.subscribe(() => this.updateBuff());

        this.selectedEffects.subscribe(() => {
            if (this.selectedEffects().length > 3)
                this.selectedEffects.splice(0, 1)[0].checked(false);
        });

        this.amount = ko.computed(() => {
            var sum = 0;
            for (var effect of this.selectedEffects()) {
                sum += Math.ceil(effect.amount * (1 + parseInt(this.selectedBuff()) / 100));
            }

            return sum;
        });
    }

    add(effect) {
        this.allEffects.push(effect);
        effect.checked.subscribe(checked => {
            var idx = this.selectedEffects.indexOf(effect);
            if (checked && idx != -1 || !checked && idx == -1)
                return;

            if (checked)
                this.selectedEffects.push(effect);
            else
                this.selectedEffects.remove(effect);
        });
    }

    updateBuff() {
        var influenceCosts = 0;
        for (var effect of this.selectedEffects()) {
            influenceCosts += effect.influenceCosts;
        }

        var threeSelected = this.selectedEffects().length >= 3;
        var selectedBuff = this.selectedBuff();

        this.selectableBuffs.removeAll();
        if (influenceCosts < 50)
            this.selectableBuffs.push(0);
        if (influenceCosts < 150 && (!threeSelected || !this.selectableBuffs().length))
            this.selectableBuffs.push(7);
        if (influenceCosts < 300 && (!threeSelected || !this.selectableBuffs().length))
            this.selectableBuffs.push(15);
        if (!threeSelected || !this.selectableBuffs().length)
            this.selectableBuffs.push(25);

        if (this.selectableBuffs.indexOf(selectedBuff) == -1)
            this.selectedBuff(this.selectableBuffs()[0]);
        else
            this.selectedBuff(selectedBuff);
    }

    apply() {
        for (var island of view.islands()) {
            island.allGoodConsumptionUpgrades.apply();
        }
    }
}

export class NewspaperNeedConsumptionEntry extends Option {
    constructor(config) {
        super(config);

        this.lockDLCIfSet(this.checked);

        this.amount = config.articleEffects[0].ArticleValue;

        this.visible = ko.pureComputed(() => this.available())
    }
}

class GoodConsumptionUpgradeEntry {
    constructor(config, assetsMap) {
        this.upgrade = config.upgrade;
        this.product = assetsMap.get(config.ProvidedNeed);
        this.amount = config.AmountInPercent;
    }
}

class GoodConsumptionUpgradeList {
    constructor(need) {
        this.upgrades = [];
        this.amount = ko.observable(100);
        this.need = need;

        this.updateAmount();
        view.newspaperConsumption.amount.subscribe(() => this.updateAmount());

        this.amount.subscribe(() => {
            if (view.settings.autoApplyConsumptionUpgrades.checked())
                setTimeout(() => this.apply(), 0);
        });
    }

    add(upgrade) {
        this.upgrades.push(upgrade);
        upgrade.upgrade.checked.subscribe(() => this.updateAmount());
    }

    updateAmount() {
        var factor = (100 + view.newspaperConsumption.amount()) / 100;

        var remainingSupply = 100;
        for (var entry of this.upgrades) {
            if (entry.upgrade.checked())
                remainingSupply += entry.amount;
        }

        this.amount(Math.max(0, remainingSupply * (100 + view.newspaperConsumption.amount()) / 100));
    }

    apply() {
        this.need.percentBoost(this.amount());
    }
}

export class GoodConsumptionUpgradeIslandList {
    constructor() {
        this.lists = [];
        this.upgrades = [];
    }

    apply() {
        for (var list of this.lists) {
            list.apply();
        }
    }
}

export class RecipeList extends NamedElement {
    constructor(list, assetsMap, island) {
        super(list);

        this.island = island;

        this.recipeBuildings = list.recipeBuildings.map(r => {
            var a = assetsMap.get(r);
            a.recipeList = this;
            return a;
        });

        this.unusedRecipes = ko.computed(() => {
            var result = [];
            for (var recipe of this.recipeBuildings) {
                if (!recipe.existingBuildings())
                    result.push(recipe);
            }

            return result;
        });
        this.selectedRecipe = ko.observable(this.recipeBuildings[0]);

        this.canCreate = ko.pureComputed(() => {
            return this.unusedRecipes().length && this.selectedRecipe();
        });

        this.visible = ko.pureComputed(() => {
            if (!this.available())
                return false;

            return this.unusedRecipes().length != 0;
        });
    }

    create() {
        if (!this.canCreate())
            return;

        this.selectedRecipe().existingBuildings(1);
    }
}
