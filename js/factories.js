// @ts-check
import { ACCURACY, EPSILON, createIntInput, createFloatInput, NamedElement } from './util.js'
import { Workforce, WorkforceDemand, WorkforceDemandSwitch } from './population.js'
import { ExtraGoodProductionList, Demand, ItemDemandSwitch, ItemExtraDemand, FactoryDemand } from './production.js'
import { TradeList, ContractList } from './trade.js'

export class Consumer extends NamedElement {
    constructor(config, assetsMap, island) {
        super(config);

        this.island = island;

        if (config.region)
            this.region = assetsMap.get(config.region);

        this.amount = ko.observable(0);
        this.boost = ko.observable(1);

        this.editable = ko.observable(false);

        this.demands = new Set();
        this.buildings = ko.computed(() => Math.max(0, parseFloat(this.amount())) / this.tpmin).extend({ deferred: true });
        this.existingBuildings = createIntInput(0, 0).extend({ deferred: true });
        this.lockDLCIfSet(this.existingBuildings);
        this.items = [];

        this.outputAmount = ko.computed(() => this.amount());

        this.tradeList = new TradeList(island, this);

        if (params.tradeContracts && (!this.island.region || this.island.region.guid == 5000000))
            this.contractList = new ContractList(island, this);

        this.notes = ko.observable("");
    }

    getInputs() {
        return this.inputs || [];
    }


    referenceProducts(assetsMap) {
        this.getInputs().forEach(i => i.product = assetsMap.get(i.Product));
        this.availableItems = ko.pureComputed(() => this.items.filter(i => i.available()));
    }


    createWorkforceDemand(assetsMap) {
        for (let m of this.maintenances || []) {
            let a = assetsMap.get(m.Product);
            if (a instanceof Workforce) {
                let items = this.items.filter(item => item.replacingWorkforce && item.replacingWorkforce != a);
                if (items.length)
                    this.workforceDemand = new WorkforceDemandSwitch($.extend({ factory: this, workforce: a }, m), items[0], assetsMap);
                else
                    this.workforceDemand = new WorkforceDemand($.extend({ factory: this, workforce: a }, m), assetsMap);

                this.existingBuildings.subscribe(val => this.workforceDemand.updateAmount(Math.max(val, this.buildings())));
                this.buildings.subscribe(val => this.workforceDemand.updateAmount(Math.max(val, this.buildings())));
            }
        }
        return null;
    }

    getRegionExtendedName() {
        if (!this.forceRegionExtendedName && (!this.region || !this.product || this.product.factories.length <= 1))
            return this.name();

        return `${this.name()} (${this.region.name()})`;
    }

    getIcon() {
        return this.icon;
    }

    updateAmount() {
        var sum = 0;
        this.demands.forEach(d => {
            var a = d.amount();
            //            if (a <= -ACCURACY || a > 0)
            sum += a;
        });

        if (this.extraDemand && sum + this.extraDemand.amount() < -ACCURACY) {
            if (sum < 0) {
                this.extraDemand.updateAmount(0);
                this.amount(0);
            } else {

                this.extraDemand.updateAmount(-sum);
            }
        }
        else {
            var val = Math.max(0, sum);
            if (val < 1e-16)
                val = 0;
            this.amount(val);
        }

    }


    add(demand) {
        this.demands.add(demand);
        this.updateAmount();
    }

    remove(demand) {
        this.demands.delete(demand);
        this.updateAmount();
    }

}

export class Module extends Consumer {
    constructor(config, assetsMap, island) {
        super(config, assetsMap, island);
        this.checked = ko.observable(false);
        this.lockDLCIfSet(this.checked);
        this.visible = ko.pureComputed(() => !!config && this.available());
    }
}

export class PublicConsumerBuilding extends Consumer {
    constructor(config, assetsMap, island) {
        super(config, assetsMap, island);

        this.needs = [];

        this.existingBuildings.subscribe(b => {
            this.amount(b * this.tpmin);

            for (var d of this.needs)
                d.updateAmount(this.amount());
        });

        this.visible = ko.computed(() => {
            if (!this.available())
                return false;

            if (this.region && this.island.region && this.region != this.island.region)
                return false;

            return true;
        });
    }

    referenceProducts(assetsMap) {
        super.referenceProducts(assetsMap);

        this.needs = [];

        for (var input of this.getInputs()) {
            var p = assetsMap.get(input.Product);
            if (p == null)
                continue;

            var d;
            let items = this.items.filter(item => item.replacements && item.replacements.has(input.Product));
            if (p.isAbstract) {
                if (items.length)
                    d = new ItemExtraDemand({ factory: ko.observable(this) }, input, items, input.Amount || 1, assetsMap);
            } else {
                if (items.length)
                    d = new ItemDemandSwitch({ factory: ko.observable(this) }, input, items, input.Amount || 1, assetsMap);
                else
                    d = new Demand({ guid: input.Product, consumer: { factory: ko.observable(this) }, "factor": input.Amount || 1 }, assetsMap);
            }

            if (d != null)
                this.needs.push(d);
        }
    }
}

export class PalaceBuff extends NamedElement {
    constructor(config, assetsMap) {
        super(config);

        this.visible = ko.pureComputed(() => this.available());
    }
}

export class Factory extends Consumer {
    constructor(config, assetsMap, island) {
        super(config, assetsMap, island);

        this.isFactory = true;

        this.extraAmount = createFloatInput(0).extend({ deferred: true });
        this.extraGoodProductionList = new ExtraGoodProductionList(this);

        this.percentBoost = createIntInput(100, 1);
        this.boost = ko.computed(() => parseInt(this.percentBoost()) / 100);

        if (config.canClip)
            this.clipped = ko.observable(false);

        if (this.module) {
            this.module = assetsMap.get(this.module);
            this.moduleChecked = ko.observable(false);
            this.module.lockDLCIfSet(this.moduleChecked);
            var workforceUpgrade = this.module.workforceAmountUpgrade ? this.module.workforceAmountUpgrade.Value : 0;
            this.moduleChecked.subscribe(checked => {
                if (checked) {
                    this.percentBoost(parseInt(this.percentBoost()) + this.module.productivityUpgrade);
                    if (this.workforceDemand)
                        this.workforceDemand.percentBoost(this.workforceDemand.percentBoost() + workforceUpgrade);
                } else {
                    var val = Math.max(1, parseInt(this.percentBoost()) - this.module.productivityUpgrade);
                    this.percentBoost(val);

                    if (this.workforceDemand)
                        this.workforceDemand.percentBoost(Math.max(0, this.workforceDemand.percentBoost() - workforceUpgrade));
                }
            });
            //moduleDemand created in island constructor after referencing products
        }

        if (this.fertilizerModule) {
            this.fertilizerModule = assetsMap.get(this.fertilizerModule);
            this.fertilizerModuleChecked = ko.observable(false);
            this.fertilizerModule.lockDLCIfSet(this.fertilizerModuleChecked);
            this.fertilizerModuleChecked.subscribe(checked => {
                if (checked) {
                    this.percentBoost(parseInt(this.percentBoost()) + this.fertilizerModule.productivityUpgrade);
                } else {
                    var val = Math.max(1, parseInt(this.percentBoost()) - this.fertilizerModule.productivityUpgrade);
                    this.percentBoost(val);
                }
            });
            //fertilizerModuleDemand created in island constructor after referencing products
        }

        if (config.palaceBuff) {
            this.palaceBuff = assetsMap.get(config.palaceBuff);
            this.palaceBuffChecked = ko.observable(false);
            this.palaceBuff.lockDLCIfSet(this.palaceBuffChecked);

            this.buffAmount = ko.computed(() => {
                var f = this.clipped && this.clipped() && this.palaceBuff.guid !== 191141 ? 2 : 1;
                return f * this.outputAmount() / this.palaceBuff.additionalOutputCycle;
            });
        }

        this.extraGoodFactor = ko.computed(() => {
            var factor = 1;

            for (var m of ["module", "fertilizerModule"]) {
                var module = this[m];
                var checked = this[m + "Checked"];

                if (module && checked() && module.additionalOutputCycle)
                    factor += 1 / module.additionalOutputCycle;
            }

            if (this.palaceBuff && this.palaceBuffChecked())
                factor += (this.clipped && this.clipped() && this.palaceBuff.guid !== 191141 /* bronce age gives no benefit from boosting */ ? 2 : 1) / this.palaceBuff.additionalOutputCycle;

            if (this.extraGoodProductionList && this.extraGoodProductionList.selfEffecting && this.extraGoodProductionList.checked())
                for (var e of this.extraGoodProductionList.selfEffecting())
                    if (e.item.checked())
                        factor += (this.clipped && this.clipped() ? 2 : 1) * (e.Amount || 1) / e.additionalOutputCycle;

            return factor;
        });

        this.requiredOutputAmount = ko.computed(() => {
            var amount = Math.max(0, parseFloat(this.amount() + parseFloat(this.extraAmount())));
            return amount / this.extraGoodFactor();
        });

        this.producedOutputAmount = ko.computed(() => {
            return this.existingBuildings() * this.boost() * this.tpmin;
        });

        this.outputAmount = ko.computed(() => Math.max(this.requiredOutputAmount(), this.producedOutputAmount()));

        this.buildings = ko.computed(() => {
            var buildings = this.requiredOutputAmount() / this.tpmin / this.boost();

            for (var m of ["module", "fertilizerModule"]) {
                var module = this[m];
                var checked = this[m + "Checked"];
                var demand = this[m + "Demand"];

                if (demand)
                    if (checked())
                        demand.updateAmount(Math.max(Math.ceil(buildings), this.existingBuildings()) * module.tpmin);
                    else
                        demand.updateAmount(0);
            }

            return buildings;
        }).extend({ deferred: true });
        this.lockDLCIfSet(this.buildings);

        if (this.workforceDemand)
            this.buildings.subscribe(val => this.workforceDemand.updateAmount(Math.max(val, this.buildings())));

        // use the history to break the cycle: extra good (lumberjack) -> building materials need (timber) -> production (sawmill) -> production (lumberjack)
        // that cycles between two values by adding a damper
        // [[prev val, timestamp], [prev prev val, timestamp]]
        this.computedExtraAmountHistory = [];
        this.computedExtraAmount = ko.computed(() => {
            var val = (this.extraGoodProductionList.checked() ? - this.extraGoodProductionList.amount() : 0) +
                this.tradeList.amount() +
                (this.contractList ? this.contractList.amount() : 0);


            if (this.computedExtraAmountHistory.length && Math.abs(val - this.computedExtraAmountHistory[0][0]) < ACCURACY)
                return this.computedExtraAmountHistory[0][0];

            var time = new Date();

            if (this.computedExtraAmountHistory.length >= 2) {
                // after initialization, we have this.computedExtraAmountHistory = [val, 0]
                // when the user manually sets it to 0, the wrong value is propagated
                // restrict to cycles triggered by automatic updates, i.e. update interval < 200 ms
                if (Math.abs(this.computedExtraAmountHistory[1][0] - val) < ACCURACY && this.computedExtraAmountHistory[1][0] !== 0 && time - this.computedExtraAmountHistory[1][1] < 200)
                    val = (val + this.computedExtraAmountHistory[0][0]) / 2;
            }

            this.computedExtraAmountHistory.unshift([val, time]);
            if (this.computedExtraAmountHistory.length > 2)
                this.computedExtraAmountHistory.pop();
            return val;
        });

        this.computedExtraAmount.subscribe(() => {
            if (view.settings.autoApplyExtraNeed.checked())
                setTimeout(() => this.updateExtraGoods(), 10);
        });

        this.amount.subscribe(() => {
            if (view.settings.autoApplyExtraNeed.checked() && this.computedExtraAmount() < 0 && this.computedExtraAmount() + ACCURACY < this.extraAmount())
                setTimeout(() => this.updateExtraGoods(), 10);
        });

        this.overProduction = ko.computed(() => {
            var val = 0;

            if (this.buildingMaterialsNeed && this.buildingMaterialsNeed.amount() > 0) {
                return this.buildingMaterialsNeed.amount();
            }

            if (view.settings.missingBuildingsHighlight.checked() || this.editable())
                var val = this.existingBuildings() * this.boost() * this.tpmin * this.extraGoodFactor();

            return val - this.amount() - this.extraAmount();
        });

        this.visible = ko.computed(() => {
            if (!this.available())
                return false;

            if (Math.abs(this.amount()) > EPSILON ||
                Math.abs(this.extraAmount()) > EPSILON ||
                this.existingBuildings() > 0 ||
                !this.island.isAllIslands() && Math.abs(this.extraGoodProductionList.amount()) > EPSILON ||
                Math.abs(this.tradeList.amount()) > EPSILON ||
                this.contractList && Math.abs(this.contractList.amount()) > EPSILON)
                return true;

            if (this.region && this.island.region && this.region != this.island.region)
                return false;

            if (view.settings.showAllConstructableFactories.checked())
                return true;

            if (this.editable()) {
                if (this.region && this.island.region)
                    return this.region === this.island.region;

                if (!this.region || this.region.guid === 5000000)
                    return true;

                return false;
            }

            return false;
        });
    }


    getOutputs() {
        return this.outputs || [];
    }

    referenceProducts(assetsMap) {
        super.referenceProducts(assetsMap);
        this.getOutputs().forEach(i => i.product = assetsMap.get(i.Product));

        this.product = this.getProduct();
        if (!this.icon)
            this.icon = this.product.icon;

        this.extraDemand = new FactoryDemand({ factory: this, guid: this.product.guid }, assetsMap);
        this.extraAmountSubscription = ko.computed(() => {
            let amount = parseFloat(this.amount());
            let val = this.extraAmount();
            if (val < -Math.ceil(amount * 100) / 100)
                this.extraAmount(- Math.ceil(amount * 100) / 100);
            else
                this.extraDemand.updateAmount(Math.max(val, -amount));
        });
    }

    getProduct() {
        return this.getOutputs()[0] ? this.getOutputs()[0].product : null;
    }

    getIcon() {
        return this.getProduct() ? this.getProduct().icon : super.getIcon();
    }

    incrementBuildings() {
        if (this.buildings() <= 0 || parseInt(this.percentBoost()) <= 1)
            return;

        var minBuildings = Math.ceil(this.buildings() * parseInt(this.percentBoost()) / (parseInt(this.percentBoost()) - 1));
        let nextBoost = Math.ceil(parseInt(this.percentBoost()) * this.buildings() / minBuildings)
        this.percentBoost(Math.min(nextBoost, parseInt(this.percentBoost()) - 1));
    }

    decrementBuildings() {
        let currentBuildings = Math.ceil(this.buildings() * 100) / 100;
        var nextBuildings = Math.floor(currentBuildings);
        if (nextBuildings <= 0)
            return;

        if (currentBuildings - nextBuildings < 0.01)
            nextBuildings = Math.floor(nextBuildings - 0.01);
        var nextBoost = Math.ceil(100 * this.boost() * this.buildings() / nextBuildings);
        if (nextBoost - parseInt(this.percentBoost()) < 1)
            nextBoost = parseInt(this.percentBoost()) + 1;
        this.percentBoost(nextBoost);
    }

    incrementPercentBoost() {
        this.percentBoost(parseInt(this.percentBoost()) + 1);
    }

    decrementPercentBoost() {
        this.percentBoost(parseInt(this.percentBoost()) - 1);
    }

    updateExtraGoods(depth) {
        var val = this.computedExtraAmount();
        var amount = this.amount();
        if (val < -Math.ceil(amount * 100) / 100)
            val = - Math.ceil(amount * 100) / 100;

        if (Math.abs(val - this.extraAmount()) < ACCURACY)
            return;

        this.extraAmount(val);

        if (depth > 0) {
            for (var route of this.tradeList.routes()) {
                route.getOppositeFactory(this).updateExtraGoods(depth - 1);
            }

            if (this.contractList) {
                for (var contract of this.contractList.exports()) {
                    contract.importFactory.updateExtraGoods(depth - 1);
                }

                for (var contract of this.contractList.imports()) {
                    contract.exportFactory.updateExtraGoods(depth - 1);
                }
            }
        }
    }

    applyConfigGlobally() {
        for (var isl of view.islands()) {
            if (this.region && isl.region && this.region != isl.region)
                continue;

            var other = isl.assetsMap.get(this.guid);

            for (var i = 0; i < this.items.length; i++)
                other.items[i].checked(this.items[i].checked());

            if (this.clipped)
                other.clipped(this.clipped());

            for (var m of ["module", "fertilizerModule"]) {
                var checked = this[m + "Checked"];
                if (checked())
                    other[m + "Checked"](checked());
            }

            if (this.palaceBuffChecked)
                other.palaceBuffChecked(this.palaceBuffChecked());

            if (this.workforceDemand && this.workforceDemand.percentBoost)
                other.workforceDemand.percentBoost(this.workforceDemand.percentBoost());

            // set boost after modules
            other.percentBoost(this.percentBoost());
        }
    }
}
