// @ts-check
import { ACCURACY } from './util.js'
import { PopulationLevel, Workforce } from './population.js'
import { PopulationNeed, ResidenceEffect, ResidenceEffectCoverage } from './consumption.js'
import { ProductCategory, Product, Demand } from './production.js'
import { Factory } from './factories.js'

var ko = require( "knockout" );

export class DarkMode {
    constructor() {
        this.checked = ko.observable(false);

        this.classAdditions = {
            "body": "bg-dark",
            //".ui-fieldset legend, body": "text-light",
            //".form-control": "text-light bg-dark bg-darker",
            //".custom-select": "text-light bg-dark bg-darker",
            //".input-group-text, .modal-content": "bg-dark text-light",
            //".btn-default": "btn-dark btn-outline-light",
            //".btn-light": "btn-dark",
            //".ui-fchain-item": "bg-dark",
            //".card": "bg-dark"
        };

        this.checked.subscribe(() => this.apply());

        if (localStorage) {
            let id = "darkMode.checked";
            if (localStorage.getItem(id) != null)
                this.checked(parseInt(localStorage.getItem(id)));

            this.checked.subscribe(val => localStorage.setItem(id, val ? 1 : 0));
        }
    }

    toggle() {
        this.checked(!this.checked());
    }

    apply() {
        if (this.checked())
            Object.keys(this.classAdditions).forEach((key) => $(key).addClass(this.classAdditions[key]));
        else
            Object.keys(this.classAdditions).reverse()
                .forEach((key) => $(key).removeClass(this.classAdditions[key]));
    }
}

export class ViewMode {
    constructor(firstRun) {
        this.hiddenOptions = [
            "additionalProduction",
            "consumptionModifier",

        ];

        /*this.simpleViewSubscription = ko.computed(() => {
            var checked = view.settings.simpleView.checked();

            if (checked) {
                view.settings.populationInput("0");
                view.settings.additionalProduction.checked(false);
                view.settings.consumptionModifier.checked(true);
                //view.settings.needUnlockConditions.checked(true);

            }

            for (var option of this.hiddenOptions)
                if (view.settings[option])
                    view.settings[option].visible(!checked);
        });*/


        this.hideSimple = false;
        /*if (firstRun || localStorage.getItem("simpleView") == null) {
            localStorage.setItem("simpleView", 0);

            this.showOnStartup = true;

            if (view.settings.additionalProduction.checked())
                this.hideSimple = true;
        }*/
        this.full();
    }

    simple() {
        view.settings.simpleView.checked(true);
    }

    complex() {
        view.settings.simpleView.checked(false);
    }

    full() {
        view.settings.simpleView.checked(false);

        view.settings.tradeRoutes.checked(true);
        view.settings.additionalProduction.checked(true);
        view.settings.consumptionModifier.checked(true);
        view.settings.missingBuildingsHighlight.checked(true);
        //view.settings.needUnlockConditions.checked(true);
        view.settings.decimalsForBuildings.checked(true);

        for (var dlc of view.dlcs.values()) {
            dlc.checked(true);
        }
    }
}

export class Template {
    constructor(asset, parentInstance, attributeName, index) {


        this.attributeName = attributeName;
        this.index = index;

        this.name = asset.name;
        this.recipeName = asset.recipeName;
        this.guid = asset.guid;
        this.getRegionExtendedName = asset.getRegionExtendedName;
        this.editable = asset.editable;
        this.region = asset.region;
        this.hotkey = asset.hotkey;

        this.templates = [];
        this.parentInstance = ko.observable(parentInstance);

        this.instance = ko.computed(() => {
            var p = this.parentInstance();

            var inst = p[this.attributeName][this.index];

            this.templates.forEach(t => t.parentInstance(inst));

            return inst;
        });

        for (var attr in asset) {
            var val = asset[attr];

            if (val instanceof Array) {
                this[attr] = val.map((a, index) => {
                    if (Template.prototype.applicable(asset)) {
                        var t = new Template(a, this.instance(), attr, index);
                        this.templates.push(t);
                        return t;
                    } else
                        return a;
                });
            }
            else if (!ko.isObservable(val) && !ko.isComputed(val) && asset.hasOwnProperty(attr))
                this[attr] = val;
        }

    }

    applicable(asset) {
        return asset instanceof PopulationLevel ||
            asset instanceof Workforce ||
            asset instanceof ProductCategory ||
            asset instanceof Product ||
            asset instanceof Factory ||
            asset instanceof Demand;
    }
}

export class ProductionChainView {
    /**
     * 
     * @param {Factory | Need} f
     */
    constructor(f) {
        //this.factoryToDemands = new Map();
        this.tree = ko.computed(() => {
/*         let traverse = (d, node) => {
                if (d.factory && d.amount) {
                    var a = ko.isObservable(d.amount) ? parseFloat(d.amount()) : parseFloat(d.amount);
                    var f = ko.isObservable(d.factory) ? d.factory() : d.factory;
                    if (Math.abs(a) < ACCURACY)
                        return node;

                    if (!node)
                        node = {
                            amount: a,
                            factory: f,
                            children: []
                        }
                    else
                        node.amount += a;
                } else
                    return node;

                var childDemands = d.demands.flatMap(e => {
                    if (e instanceof ItemDemandSwitch || e instanceof FactoryDemandSwitch)
                        return e.demands;
                    else if (e instanceof ItemExtraDemand)
                        return [e.demand];
                    return [e];
                });

                if (node.children.length) {
                    for (var i = 0; i < node.children.length; i++) {
                        if (node.children[i])
                            traverse(childDemands[i], node.children[i]);
                    }
                } else {
                    for (var e of childDemands) {
                        node.children.push(traverse(e));
                    }
                }

                return node;
            }

            var root = null;
            var demands = f.demands;

            if (f instanceof PopulationNeed) {
                root = traverse(f);
            }
            else if (!demands.size && f.needs && f.needs.length) {
                root = {
                    amount: f.amount(),
                    factory: f,
                    buildings: f.existingBuildings(),
                    children: []
                }

                for (var d of f.needs) {
                    if (d instanceof ItemDemandSwitch || d instanceof FactoryDemandSwitch)
                        for (var e of d.demands)
                            root.children.push(traverse(e));
                    else if (d instanceof ItemExtraDemand)
                        root.children.push(traverse(d.demand));
                    else
                        root.children.push(traverse(d));
                }
            } else {


                ////this.factoryToDemands.clear();
                for (var d of f.demands) {
                    root = traverse(d, root);
                }

                if (f.extraDemand) {
                    root = traverse(view.selectedFactory().extraDemand, root);
                }
            }

            let processNode = node => {
                if (!node)
                    return;

                if (!node.buildings) {
                    var factor = 1;

                    if (node.factory.extraGoodFactor)
                        factor = node.factory.extraGoodFactor();

                    var inputAmount = node.amount / factor;
                    node.buildings = Math.max(0, inputAmount) / node.factory.tpmin / node.factory.boost();
                }

                node.children.forEach(c => processNode(c));
                node.children = node.children.filter(c => c && c.amount > ACCURACY);
            }

            processNode(root);

            return root;
            */
            return null;
        });
    }
}

class ResidenceEffectAggregate {
    /**
     * 
     * @param {ko.observable} totalResidences
     * @param {ResidenceBuilding} residence
     * @param {ResidenceEffectCoverage} residenceEffectCoverage
     */
    constructor(totalResidences, residenceEffectCoverage) {
        this.totalResidences = totalResidences;
        this.residenceEffect = residenceEffectCoverage.residenceEffect;

        this.coverage = [residenceEffectCoverage];
    }

    add(residenceEffectCoverage) {
        this.coverage.push(residenceEffectCoverage);
    }

    finishInitialization() {
        this.averageCoverage = ko.pureComputed(() => {
            var sum = 0;
            this.coverage.forEach(coverage => { sum += coverage.residence.existingBuildings() * coverage.coverage(); });

            return sum / this.totalResidences();
        });
    }
}

export class ResidenceEffectView {
    constructor(residences, need = null) {
        this.residences = residences.filter(r => r.available());
        this.percentCoverage = ko.observable(100);

        this.totalResidences = ko.pureComputed(() => {
            var sum = 0;
            this.residences.forEach(r => { sum += r.existingBuildings(); });
            return sum;
        });

        var effects = new Set();
        var aggregatesMap = new Map();
        this.consumedProducts = new Set();
        this.residences.forEach(r => {
            r.populationLevel.needsMap.forEach(n => {
                this.consumedProducts.add(n.product);
            });

            r.allEffects.forEach((/** @type ResidenceEffect */ e) => {
                if (e.available() && (need == null || e.effectsPerNeed.has(need.guid)))
                    effects.add(e);
            });

            r.effectCoverage().forEach((/** @type ResidenceEffectCoverage */ c) => {
                var e = c.residenceEffect;
                if (aggregatesMap.has(e)) {
                    aggregatesMap.get(e).add(c);
                } else {
                    aggregatesMap.set(e, new ResidenceEffectAggregate(this.totalResidences, c));
                }
            })
        });

        this.allEffects = [...effects];        
        
        this.aggregates = ko.observableArray([]);
        aggregatesMap.forEach((a, e) => {
            a.finishInitialization();
            effects.delete(e);
            this.aggregates.push(a);
        });
        this.unusedEffects = ko.observableArray([...effects]);

        this.need = need;
        if (need instanceof PopulationNeed) {
            this.productionChainView = new ProductionChainView(need);
        }

        this.sort();
        this.selectedEffect = ko.observable(this.unusedEffects()[0]);
        view.settings.language.subscribe(() => {
            this.sort();
        })
    }

    create() {
        var e = this.selectedEffect();
        var a = null;
        e.residences.forEach(r => {
            if (this.residences.indexOf(r) == -1)
                return;

            var c = new ResidenceEffectCoverage(r, e, this.percentCoverage() / 100);
            r.addEffectCoverage(c);

            if (a == null) {

                a = new ResidenceEffectAggregate(this.totalResidences, c);
            } else {
                a.add(c);
            }
        });

        if (a != null) {
            this.unusedEffects.remove(e);
            this.aggregates.push(a);
            this.sort();
        }
    }

    delete(aggregate) {
        aggregate.coverage.forEach(coverage => {
            coverage.residence.removeEffectCoverage(coverage);
        });

        this.unusedEffects.push(aggregate.residenceEffect);
        this.aggregates.remove(aggregate);
        this.sort();
        this.selectedEffect(aggregate.residenceEffect);
        this.percentCoverage(aggregate.coverage[0].coverage() * 100);
    }

    sort() {
        this.aggregates.sort((a, b) => a.residenceEffect.compare(b.residenceEffect));
        this.unusedEffects.sort((a, b) => a.compare(b));
    }

    applyConfigGlobally() {
        for (var isl of view.islands()) {
            // region is null for allIslands
            if (this.region && isl.region && this.region != isl.region)
                continue;

            for (var r of this.residences)
                if (isl.assetsMap.has(r.guid))
                    isl.assetsMap.get(r.guid).applyEffects(r.serializeEffects());

        }
    }
}