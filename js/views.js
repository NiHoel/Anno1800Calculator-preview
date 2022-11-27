// @ts-check
import { ACCURACY } from './util.js'
import { PopulationLevel, Workforce } from './population.js'
import { ProductCategory, Product, Demand, ItemDemandSwitch, FactoryDemandSwitch, ItemExtraDemand } from './production.js'
import { Factory } from './factories.js'

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
            "autoApplyExtraNeed",
            "consumptionModifier",
            "autoApplyConsumptionUpgrades",
            "deriveResidentsPerHouse"
        ];

        this.simpleViewSubscription = ko.computed(() => {
            var checked = view.settings.simpleView.checked();

            if (checked) {
                view.settings.populationInput("0");
                view.settings.additionalProduction.checked(false);
                view.settings.autoApplyExtraNeed.checked(true);
                view.settings.consumptionModifier.checked(true);
                view.settings.autoApplyConsumptionUpgrades.checked(true);
                view.settings.needUnlockConditions.checked(true);
                view.settings.deriveResidentsPerHouse.checked(true);
            }

            for (var option of this.hiddenOptions)
                if (view.settings[option])
                    view.settings[option].visible(!checked);
        });
        view.settings.deriveResidentsPerHouse.checked.subscribe(checked => {
            if (!checked) { // gets disabled when using skyscrapers or special residences
                view.settings.simpleView.checked(false);
            }

            view.settings.simpleView.visible(checked);
        })


        this.hideSimple = false;
        if (firstRun || localStorage.getItem("simpleView") == null) {
            localStorage.setItem("simpleView", 0);

            this.showOnStartup = true;

            if (view.settings.additionalProduction.checked())
                this.hideSimple = true;
        }
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
        view.settings.needUnlockConditions.checked(true);
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
    constructor() {
        //this.factoryToDemands = new Map();
        this.tree = ko.computed(() => {
            let traverse = (d, node) => {
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

            var f = view.selectedFactory();
            var root = null;
            var demands = f.demands;
            if (!demands.size && f.needs && f.needs.length) {
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
        });
    }
}

