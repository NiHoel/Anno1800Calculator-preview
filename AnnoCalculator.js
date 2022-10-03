// @ts-check

let versionCalculator = "v9.1";
let ACCURACY = 0.01;
let EPSILON = 0.0000001;
let ALL_ISLANDS = "All Islands";


view = {
    settings: {
        language: ko.observable("english")
    },
    texts: new Map(),
    dlcs: [],
    dlcsMap: new Map()
};

for (var code in languageCodes)
    if (navigator.language.startsWith(code))
        view.settings.language(languageCodes[code]);

// called after initialization
// checks if loaded config is old and applies upgrade
function configUpgrade() {
    {
        let id = "settings.contracts";
        if (localStorage.getItem(id) != null && parseInt(localStorage.getItem(id))) {
            var dlc = view.dlcsMap.get("dlc7");
            if (dlc)
                dlc.checked(true);
        }
        localStorage.removeItem(id);
    }

    {
        let id = "upgrade.bonusResidentsApplied";
        if (!localStorage.getItem(id)) {


            for (var isl of view.islands())
                for (var l of isl.populationLevels) {
                    for (var r of l.allResidences) {
                        if (r.guid === 406) //Skyline Tower
                            continue;

                        let id = r.guid + ".limitPerHouse";
                        if ((isl.storage || localStorage).getItem(id) == null)
                            continue; // initialized with new value and not overwritten by config

                        residents = 0
                        for (var n of l.bonusNeeds)
                            if (n.available())
                                residents += r.residentsPerNeed.get(n.guid) || 0

                        if (l.allResidences.length == 1)
                            l.limitPerHouse(l.limitPerHouse() + residents);
                        r.limitPerHouse(r.limitPerHouse() + residents)
                    }
                }
        }
        localStorage.setItem(id, 1);
    }
}

class Storage {
    /**
     * 
     * @param {string} key
     */
    constructor(key) {
        this.key = key;
        var text = localStorage.getItem(key);
        this.json = text ? JSON.parse(text) : {};

        this.length = 0;
        for (var attr in this.json)
            this.length = this.length + 1;
    }

    setItem(itemKey, value) {
        if (this.json[itemKey] == null)
            this.length = this.length + 1;

        this.json[itemKey] = value;
        this.save();
    }

    getItem(itemKey) {
        return this.json[itemKey];
    }

    removeItem(itemKey) {
        if (this.json[itemKey] != null)
            this.length = this.length - 1;

        delete this.json[itemKey];
        this.save();
    }

    key(index) {
        var i = 0;
        for (let attr in this.json)
            if (i++ == index)
                return attr;

        return null;
    }

    /**
     * 
     * @param {string} key
     */
    updateKey(key) {
        localStorage.removeItem(this.key);
        this.key = key;
        this.save();
    }

    clear() {
        this.json = {}
        this.save();
        this.length = 0;
    }

    save() {
        localStorage.setItem(this.key, JSON.stringify(this.json, null, 4));
    }
}

class NamedElement {
    constructor(config) {
        $.extend(this, config);
        this.locaText = this.locaText || {}
        this.name = ko.computed(() => {

            let text = this.locaText[view.settings.language()];
            if (text)
                return text;

            text = this.locaText["english"];
            return text ? text : config.name;
        });

        if (this.iconPath && params && params.icons)
            this.icon = params.icons[this.iconPath];

        if (this.dlcs && params && params.dlcs) {
            this.dlcs = this.dlcs.map(d => view.dlcsMap.get(d)).filter(d => d);
            this.available = ko.pureComputed(() => {
                for (var d of this.dlcs) {
                    if (d.checked())
                        return true;
                }

                return false;
            });
            this.dlcLockingObservables = [];
        } else {
            this.available = ko.pureComputed(() => true)
        }

    }

    lockDLCIfSet(obs) {
        if (this.dlcs == null || this.dlcs.length != 1)
            return;

        this.dlcLockingObservables.push(obs);
        this.dlcs[0].addDependentObject(obs);
    }

    delete() {
        if (this.dlcs == null || this.dlcs.length != 1)
            return;

        for (var obs of this.dlcLockingObservables)
            this.dlcs[0].removeDependentObject(obs);
    }
}

class Region extends NamedElement { }
class Session extends NamedElement {
    constructor(config, assetsMap) {
        super(config);

        this.region = assetsMap.get(config.region);
        this.islands = ko.observableArray([]);
        this.lockDLCIfSet(ko.pureComputed(() => this.islands().length))

        this.workforce = [];

        for (let workforce of params.workforce) {
            let w = new CommuterWorkforce(workforce, this);
            this.workforce.push(w);
        }
    }

    addIsland(isl) {
        this.islands.push(isl);
    }

    deleteIsland(isl) {
        this.islands.remove(isl);
    }
}

class Option extends NamedElement {
    constructor(config) {
        super(config);
        this.checked = ko.observable(false);
        this.visible = ko.observable(!!config);
    }
}

class DLC extends Option {
    constructor(config) {
        super(config);

        this.dependentObjects = ko.observableArray([]).extend({ deferred: true }); // notify subscribers at most once per 500 ms

        this.used = ko.pureComputed(() => {
            for (var obs of this.dependentObjects())
                if (obs() != 0) // can be int, float or bool -> non-strict comparison
                    return true;

            return false;
        });

        this.used.subscribe(val => {
            if (val)
                this.checked(true);
        })
    }

    /**
     * 
     * @param {ko.observable} obs
     */
    addDependentObject(obs) {
        this.dependentObjects.push(obs);
    }

    /**
     *
     * @param {ko.observable} obs
     */
    removeDependentObject(obs) {
        this.dependentObjects.remove(obs);
    }
}

class Island {
    constructor(params, localStorage, isNew, session) {
        if (localStorage instanceof Storage) {
            this.name = ko.observable(localStorage.key);
            this.name.subscribe(name => this.storage.updateKey(name));
            this.isAllIslands = function () { return false; };
        } else {
            this.name = ko.computed(() => view.texts.allIslands.name());
            this.isAllIslands = function () { return true; };
        }
        this.storage = localStorage;

        this.session = session || this.storage.getItem("session");
        this.session = this.session instanceof Session ? this.session : view.assetsMap.get(this.session);
        this.region = this.session ? this.session.region : null;

        this.storage.setItem("session", this.session ? this.session.guid : null);

        var assetsMap = new Map();
        for (var key of view.assetsMap.keys())
            assetsMap.set(key, view.assetsMap.get(key));

        this.sessionExtendedName = ko.pureComputed(() => {
            if (!this.session)
                return this.name();

            return `${this.session.name()} - ${this.name()}`;
        });

        // procedures to persist inputs
        var persistBool, persistInt, persistFloat, persistString;

        if (localStorage) {
            persistBool = (obj, attributeName, storageName) => {

                var attr = obj[attributeName];
                if (attr) {
                    let id = storageName ? storageName : (obj.guid + "." + attributeName);
                    if (localStorage.getItem(id) != null)
                        attr(parseInt(localStorage.getItem(id)));

                    attr.subscribe(val => localStorage.setItem(id, val ? 1 : 0));
                }
            }

            persistInt = (obj, attributeName, storageName) => {

                var attr = obj[attributeName];
                if (attr) {
                    let id = storageName ? storageName : (obj.guid + "." + attributeName);
                    if (localStorage.getItem(id) != null)
                        attr(parseInt(localStorage.getItem(id)));

                    attr.subscribe(val => {
                        val = parseInt(val);

                        if (val == null || !isFinite(val) || isNaN(val))
                            return;

                        localStorage.setItem(id, val);
                    });
                }
            }

            persistFloat = (obj, attributeName, storageName) => {

                var attr = obj[attributeName];
                if (attr) {
                    let id = storageName ? storageName : (obj.guid + "." + attributeName);
                    if (localStorage.getItem(id) != null)
                        attr(parseFloat(localStorage.getItem(id)));

                    attr.subscribe(val => {
                        val = parseFloat(val);

                        if (val == null || !isFinite(val) || isNaN(val))
                            return;

                        localStorage.setItem(id, val);
                    });
                }
            }

            persistString = (obj, attributeName, storageName) => {

                var attr = obj[attributeName];
                if (attr) {
                    let id = storageName ? storageName : (obj.guid + "." + attributeName);
                    if (localStorage.getItem(id) != null)
                        attr(localStorage.getItem(id));

                    attr.subscribe(val => localStorage.setItem(id, val));
                }
            }

        } else {
            persistBool = persistFloat = persistInt = persistString = () => { };
        }

        // objects

        this.populationLevels = [];
        this.residenceBuildings = [];
        this.powerPlants = [];
        this.publicRecipeBuildings = [];
        this.consumers = [];
        this.factories = [];
        this.categories = [];
        this.buildingMaterialsNeeds = [];
        this.multiFactoryProducts = [];
        this.items = [];
        this.replaceInputItems = [];
        this.extraGoodItems = [];
        this.allGoodConsumptionUpgrades = new GoodConsumptionUpgradeIslandList();
        this.recipeLists = [];
        this.workforce = [];

        this.commuterPier = new Option({
            name: "Commuter Pier",
            locaText: texts.commuterPier
        });
        this.commuterPier.visible(this.region && (this.region.guid === 5000000 || this.region.guid === 5000001));
        persistBool(this.commuterPier, "checked", "settings.commuterPier.checked");

        for (let workforce of params.workforce) {
            let w = new Workforce(workforce, assetsMap);
            assetsMap.set(w.guid, w);
            this.workforce.push(w);
        }

        for (let consumer of (params.powerPlants || [])) {

            let f = new PublicConsumerBuilding(consumer, assetsMap, this);
            assetsMap.set(f.guid, f);
            this.consumers.push(f);
            this.powerPlants.push(f);

            // values for existingBuildings are read from localstorage later, after products are referenced
        }

        for (let consumer of (params.publicRecipeBuildings || [])) {

            let f = new PublicConsumerBuilding(consumer, assetsMap, this);
            assetsMap.set(f.guid, f);
            this.consumers.push(f);
            this.publicRecipeBuildings.push(f);

            // values for existingBuildings are read from localstorage later, after products are referenced
        }

        for (let list of (params.recipeLists || [])) {
            if (!list.region || !this.region || list.region === this.region.guid)
                this.recipeLists.push(new RecipeList(list, assetsMap, this));
        }

        for (let consumer of (params.modules || [])) {
            let f = new Module(consumer, assetsMap, this);
            assetsMap.set(f.guid, f);
            this.consumers.push(f);
        }

        for (let buff of (params.palaceBuffs || [])) {
            let f = new PalaceBuff(buff, assetsMap);
            assetsMap.set(f.guid, f);
        }

        for (let factory of params.factories) {
            let f = new Factory(factory, assetsMap, this);
            assetsMap.set(f.guid, f);
            this.consumers.push(f);
            this.factories.push(f);

            if (f.clipped)
                persistBool(f, "clipped", `${f.guid}.clipped.checked`)

            // set moduleChecked before boost, otherwise boost would be increased
            persistBool(f, "moduleChecked", `${f.guid}.module.checked`);
            persistBool(f, "fertilizerModuleChecked", `${f.guid}.fertilizerModule.checked`);
            persistBool(f, "palaceBuffChecked", `${f.guid}.palaceBuff.checked`);
            persistInt(f, "percentBoost");
        }

        let products = [];
        let noFactoryProducts = [];
        for (let product of params.products) {
            if (product.residentsInputFactor) {
                let p = new NoFactoryProduct(product, assetsMap);
                noFactoryProducts.push(p);
                assetsMap.set(p.guid, p);
            } else if (product.producers && product.producers.length) {
                let p = new Product(product, assetsMap);

                products.push(p);
                assetsMap.set(p.guid, p);

                if (p.factories.length > 1)
                    this.multiFactoryProducts.push(p);

                if (localStorage) {
                    let id = p.guid + ".fixedFactory";
                    if (localStorage.getItem(id) != null)
                        p.fixedFactory(assetsMap.get(parseInt(localStorage.getItem(id))));
                    p.fixedFactory.subscribe(
                        f => f ? localStorage.setItem(id, f.guid) : localStorage.removeItem(id));

                }
            } else {
                let p = new MetaProduct(product, assetsMap);

                assetsMap.set(p.guid, p);
            }
        }

        if (isNew)
            setDefaultFixedFactories(assetsMap);

        for (let item of (params.items || [])) {
            let i = new Item(item, assetsMap, this.region);
            if (!i.factories.length)
                continue;  // Affects no factories in this region

            assetsMap.set(i.guid, i);
            this.items.push(i);

            if (i.replacements)
                this.replaceInputItems.push(i);

            if (i.additionalOutputs)
                this.extraGoodItems.push(i);

            if (localStorage) {
                let oldId = i.guid + ".checked";
                var oldChecked = false;
                if (localStorage.getItem(oldId) != null)
                    oldChecked = !!parseInt(localStorage.getItem(oldId));

                for (var equip of i.equipments) {
                    let id = `${equip.factory.guid}[${i.guid}].checked`;

                    if (oldChecked)
                        equip.checked(true);

                    if (localStorage.getItem(id) != null)
                        equip.checked(parseInt(localStorage.getItem(id)));

                    equip.checked.subscribe(val => localStorage.setItem(id, val ? 1 : 0));
                }

                localStorage.removeItem(oldId);
            }
        }

        this.extraGoodItems.sort((a, b) => a.name().localeCompare(b.name()));
        view.settings.language.subscribe(() => {
            this.extraGoodItems.sort((a, b) => a.name().localeCompare(b.name()));
        });

        // must be set after items so that extraDemand is correctly handled
        this.consumers.forEach(f => {
            f.createWorkforceDemand(assetsMap);
            f.referenceProducts(assetsMap);
        });

        // setup demands induced by modules
        for (let factory of params.factories) {
            let f = assetsMap.get(factory.guid);

            if (!f)
                continue;

            for (var m of ["module", "fertilizerModule"]) {
                var module = f[m];

                if (module)
                    f[m + "Demand"] = new Demand({ guid: module.getInputs()[0].Product, region: f.region }, assetsMap);
            }
        }


        for (var building of (params.residenceBuildings || [])) {
            var b = new ResidenceBuilding(building, assetsMap, this);
            assetsMap.set(b.guid, b);
            this.residenceBuildings.push(b);
        }

        for (let level of params.populationLevels) {

            let l = new PopulationLevel(level, assetsMap, this);
            assetsMap.set(l.guid, l);
            this.populationLevels.push(l);
        }

        for (var b of this.residenceBuildings) {
            if (b.upgradedBuilding)
                b.upgradedBuilding = assetsMap.get(parseInt(b.upgradedBuilding));
        }

        for (let l of this.populationLevels)
            l.initBans(assetsMap);  // must be executed before loading the values for residence buildings - otherwise banned needs are activated which activate dlcs

        for (let b of this.residenceBuildings) {
            persistInt(b, "existingBuildings");
            persistFloat(b, "limitPerHouse");
            persistInt(b, "limit");
            persistBool(b, "fixLimitPerHouse");
        }

        for (let l of this.populationLevels) {
            persistInt(l, "existingBuildings");
            persistFloat(l, "limitPerHouse");
            persistFloat(l, "amountPerHouse");
            persistInt(l, "limit");
            persistInt(l, "amount");
            persistBool(l, "fixLimitPerHouse");
            persistBool(l, "fixAmountPerHouse");
            persistString(l, "notes");

            for (let n of l.needs) {
                persistBool(n, "checked", `${l.guid}[${n.guid}].checked`);
                persistFloat(n, "percentBoost", `${l.guid}[${n.guid}].percentBoost`);
                persistString(n, "notes", `${l.guid}[${n.guid}].notes`);
            }

            for (let n of l.buildingNeeds) {
                persistBool(n, "checked", `${l.guid}[${n.guid}].checked`);
            }

        }


        for (var category of params.productFilter) {
            let c = new ProductCategory(category, assetsMap);
            assetsMap.set(c.guid, c);
            this.categories.push(c);
        }


        for (let p of this.categories[1].products) {
            if (p)
                for (let b of p.factories) {
                    if (b) {
                        b.editable(true);
                        let n = new BuildingMaterialsNeed({ guid: p.guid, factory: b, product: p }, assetsMap);
                        b.boost.subscribe(() => n.updateAmount());
                        b.existingBuildings.subscribe(() => n.updateAmount());
                        b.amount.subscribe(() => n.updateAmount());
                        b.extraAmount.subscribe(() => n.updateAmount());
                        if (b.palaceBuff)
                            b.palaceBuffChecked.subscribe(() => n.updateAmount());
                        this.buildingMaterialsNeeds.push(n);

                        persistInt(b, "existingBuildings");

                        n.updateAmount();
                    }
                }
        }

        for (let upgrade of (params.goodConsumptionUpgrades || [])) {
            let u = new GoodConsumptionUpgrade(upgrade, assetsMap, this.populationLevels);
            if (!u.populationLevels.length)
                continue;

            assetsMap.set(u.guid, u);
            this.allGoodConsumptionUpgrades.upgrades.push(u);

            persistBool(u, "checked");
        }

        for (let level of this.populationLevels)
            for (let need of level.needs) {
                this.allGoodConsumptionUpgrades.lists.push(need.goodConsumptionUpgradeList);
            }

        for (let b of this.publicRecipeBuildings) {
            if (b.goodConsumptionUpgrade)
                b.goodConsumptionUpgrade = assetsMap.get(b.goodConsumptionUpgrade);

            if (b.goodConsumptionUpgrade) {
                b.goodConsumptionUpgrade.checked.subscribe(checked => {
                    if (checked)
                        b.existingBuildings(Math.max(1, b.existingBuildings()));
                });

                b.existingBuildings.subscribe(val => {
                    if (!val)
                        b.goodConsumptionUpgrade.checked(false);
                });
            }

            b.recipeName = ko.computed(() => {
                return b.name().split(':').slice(-1)[0].trim();
            });
        }

        for (let f of this.consumers) {
            persistInt(f, "existingBuildings");
            persistString(f, "notes");
            if (f.workforceDemand)
                persistInt(f.workforceDemand, "percentBoost", `${f.guid}.workforce.percentBoost`);
        }

        // negative extra amount must be set after the demands of the population and public buildings are generated
        // otherwise it would be set to zero
        for (let f of this.factories) {
            persistFloat(f, "extraAmount");
            persistBool(f.extraGoodProductionList, "checked", `${f.guid}.extraGoodProductionList.checked`);
        }

        // force update once all pending notifications are processed
        setTimeout(() => { this.buildingMaterialsNeeds.forEach(b => b.updateAmount()) }, 1000);

        this.workforce = this.workforce.filter(w => w.demands.length);

        this.assetsMap = assetsMap;
        this.products = products;
        this.noFactoryProducts = noFactoryProducts;

        this.top2Population = ko.computed(() => {
            var useHouses = view.settings.populationInput() == "0";
            var comp = useHouses
                ? (a, b) => b.existingBuildings() - a.existingBuildings()
                : (a, b) => b.amount() - a.amount();

            return [...this.populationLevels].sort(comp).slice(0, 2).filter(l => useHouses ? l.existingBuildings() : l.amount());
        });

        this.top5Factories = ko.computed(() => {
            var useBuildings = view.settings.missingBuildingsHighlight.checked();
            var comp = useBuildings
                ? (a, b) => b.existingBuildings() - a.existingBuildings()
                : (a, b) => b.buildings() - a.buildings();

            return [...this.factories].sort(comp).slice(0, 5).filter(f => useBuildings ? f.existingBuildings() : f.buildings());
        });

        if (params.tradeContracts && (!this.region || this.region.guid == 5000000))
            this.contractManager = new ContractManager(this);

        if (isNew)
            this.allGoodConsumptionUpgrades.apply();

        if (view.settings.autoApplyConsumptionUpgrades.checked()) {
            for (let l of this.populationLevels)
                for (let n of l.needs) {
                    let id = `${l.guid}[${n.guid}].percentBoost`;

                    if (localStorage.getItem(id) == null)
                        n.goodConsumptionUpgradeList.apply();
                }
        }

        if (this.session)
            this.session.addIsland(this);

        this.workforceSectionVisible = ko.pureComputed(() => {
            for (var w of this.commuterPier.checked() ? this.session.workforce : this.workforce)
                if (w.visible())
                    return true;

            return false;
        });

        this.publicBuildingsSectionVisible = ko.pureComputed(() => {
            for (var b of this.powerPlants)
                if (b.visible())
                    return true;

            for (var b of this.noFactoryProducts)
                if (b.visible())
                    return true;

            for (var b of this.publicRecipeBuildings)
                if (b.visible())
                    return true;

            for (var b of this.recipeLists)
                if (b.visible())
                    return true;

            return false;
        });
    }

    reset() {
        if (this.commuterPier)
            this.commuterPier.checked(false);

        {
            var deletedRoutes = view.tradeManager.routes().filter(r => r.to === this || r.from === this);
            deletedRoutes.forEach(r => view.tradeManager.remove(r));
        }

        {
            var deletedRoutes = view.tradeManager.npcRoutes().filter(r => r.to === this);
            deletedRoutes.forEach(r => view.tradeManager.remove(r));
        }

        this.assetsMap.forEach(a => {
            if (a instanceof Option)
                a.checked(false);
            if (a instanceof Product)
                a.fixedFactory(null);
            if (a instanceof Consumer) {
                a.existingBuildings(0);
                if (a.workforceDemand && a.workforceDemand.percentBoost)
                    a.workforceDemand.percentBoost(100);
            }
            if (a instanceof Factory) {
                if (a.clipped)
                    a.clipped(false);
                for (var m of ["module", "fertilizerModule"]) {
                    var checked = a[m + "Checked"];
                    if (checked)
                        checked(false);
                }
                if (a.palaceBuffChecked)
                    a.palaceBuffChecked(false);
                a.percentBoost(100);
                a.extraAmount(0);
                a.extraGoodProductionList.checked(true);
            }
            if (a instanceof ResidenceBuilding) {
                a.existingBuildings(0);
                a.limitPerHouse(a.limitLowerBound);
                a.limit(0);
                a.fixLimitPerHouse(true);
            }
            if (a instanceof PopulationLevel) {
                a.existingBuildings(0);
                a.amountPerHouse(a.fullHouse);
                a.limitPerHouse(a.residence.limitLowerBound);
                a.amount(0);
                a.limit(0);
                a.fixAmountPerHouse(true);
                a.fixLimitPerHouse(true);
                for (var n of (a.needs || []))
                    if (n.notes)
                        n.notes("");
            }
            if (a instanceof Item) {
                a.checked(false);
                for (var i of a.equipments)
                    i.checked(false);
            }
            if (a.notes)
                a.notes("");
        });

        setDefaultFixedFactories(this.assetsMap);

        this.populationLevels.forEach(l => l.needs.forEach(n => {
            if (n.checked)
                if (n.isBonusNeed || n.excludePopulationFromMoneyAndConsumptionCalculation)
                    n.checked(false);
                else
                    n.checked(true);
            if (n.percentBoost)
                if (view.settings.autoApplyConsumptionUpgrades.checked())
                    n.goodConsumptionUpgradeList.apply();
                else
                    n.percentBoost(100);
        }));

        this.populationLevels.forEach(l => l.buildingNeeds.forEach(n => {
            if (n.checked)
                if (n.isBonusNeed || n.excludePopulationFromMoneyAndConsumptionCalculation)
                    n.checked(false);
                else
                    n.checked(true);
        }));
    }
}

class Consumer extends NamedElement {
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
        if (!this.region || !this.product || this.product.factories.length <= 1)
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

class Module extends Consumer {
    constructor(config, assetsMap, island) {
        super(config, assetsMap, island);
        this.checked = ko.observable(false);
        this.lockDLCIfSet(this.checked);
        this.visible = ko.pureComputed(() => !!config && this.available());
    }
}

class PublicConsumerBuilding extends Consumer {
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

class PalaceBuff extends NamedElement {
    constructor(config, assetsMap) {
        super(config);

        this.visible = ko.pureComputed(() => this.available());
    }
}

class Factory extends Consumer {
    constructor(config, assetsMap, island) {
        super(config, assetsMap, island);

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

class Product extends NamedElement {
    constructor(config, assetsMap) {
        super(config);


        this.amount = ko.observable(0);

        this.factories = this.producers.map(p => assetsMap.get(p)).filter(p => !!p);
        this.availableFactories = ko.pureComputed(() => this.factories.filter(f => f.available()));

        this.fixedFactory = ko.observable(null);
        if (this.mainFactory)
            this.mainFactory = assetsMap.get(this.mainFactory);

        if (this.producers && this.factories.length) {
            this.amount = ko.computed(() => this.factories.map(f => f.amount()).reduce((a, b) => a + b));
            this.lockDLCIfSet(this.amount); // if routes sum up to exactly zero, usage might still end up at 0.
        }

        this.visible = ko.pureComputed(() => this.available());
    }
}

class MetaProduct extends NamedElement {
    constructor(config, assetsMap) {
        super(config);
    }
}

class NoFactoryProduct extends NamedElement {
    constructor(config, assetsMap) {
        super(config);

        this.needs = ko.observableArray([]);
        this.amount = ko.computed(() => this.needs().map(n => n.amount()).reduce((a, b) => a + b, 0));
        this.lockDLCIfSet(this.amount);

        this.residentsInput = ko.pureComputed(() => {
            return this.amount() * this.residentsInputFactor;
        });

        this.visible = ko.computed(() => {
            return this.available() && this.amount() > 0;
        });
    }

    addNeed(need) {
        this.needs.push(need);
    }
}

class PublicBuildingNeed extends Option {
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
                for (var r of this.residences)
                    if (r.existingBuildings() > 0)
                        return false;

                return true;
            });
        }
    }
}

class NoFactoryNeed extends PublicBuildingNeed {
    constructor(config, level, assetsMap) {
        super(config, assetsMap);
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

class Demand extends NamedElement {
    constructor(config, assetsMap) {
        super(config);

        this.amount = ko.observable(0);
        if (this.factor == null)
            this.factor = 1;

        this.product = assetsMap.get(this.guid);
        if (!this.product)
            throw `No Product ${this.guid}`;
        this.factory = ko.observable(config.factory);

        if (this.product) {
            this.updateFixedProductFactory(this.product.fixedFactory());
            this.product.fixedFactory.subscribe(f => this.updateFixedProductFactory(f));
        }

        this.inputAmount = ko.computed(() => {
            var amount = parseFloat(this.amount());

            var factor = 1;

            if (this.factory() && this.factory().extraGoodFactor)
                factor = this.factory().extraGoodFactor();

            return amount / factor;

        });

        if (this.consumer)
            this.consumer.factory.subscribe(() => this.updateFixedProductFactory(this.product.fixedFactory()));

        if (this.product && this.product.differentFactoryInputs) {
            this.demands = [new FactoryDemandSwitch(this, assetsMap)];
            this.inputAmount.subscribe(val => this.demands[0].updateAmount(val * this.factor));
        }
        else {
            this.demands = [];

            for (var input of this.factory().getInputs()) {
                var p = assetsMap.get(input.Product);
                if (p == null)
                    continue;

                var d;
                let items = this.factory().items.filter(item => item.replacements && item.replacements.has(input.Product));
                if (p.isAbstract) {
                    if (items.length)
                        d = new ItemExtraDemand(this, input, items, input.Amount || 1, assetsMap);
                } else {
                    if (items.length)
                        d = new ItemDemandSwitch(this, input, items, input.Amount || 1, assetsMap);
                    else
                        d = new Demand({ guid: input.Product, consumer: this, "factor": input.Amount || 1 }, assetsMap);
                }

                if (d != null)
                    this.demands.push(d);
            }

            this.inputAmount.subscribe(val => {
                for (var d of this.demands)
                    d.updateAmount(val);
            })
        }

        this.amount.subscribe(val => {
            this.factory().updateAmount();
        });

        this.buildings = ko.computed(() => {
            var factory = this.factory();
            var factor = factory.extraGoodFactor ? factory.extraGoodFactor() : 1;
            var buildings = Math.max(0, this.inputAmount()) / factor / factory.tpmin / factory.boost();

            return buildings;
        }).extend({ deferred: true });

    }

    updateFixedProductFactory(f) {
        if (f == null && (this.consumer || this.region)) { // find factory in the same region as consumer
            let region = this.region || this.consumer.factory().region;
            if (region && !(this.product.mainFactory && this.product.mainFactory.region === region)) {
                for (let fac of this.product.factories) {
                    if (fac.region === region) {
                        f = fac;
                        break;
                    }
                }
            }
        }

        if (f == null) // region based approach not successful
            f = this.product.mainFactory || this.product.factories[0];

        if (f != this.factory()) {
            if (this.factory())
                this.factory().remove(this);

            this.factory(f);
            f.add(this);
        }
    }

    updateAmount(amount) {
        amount *= this.factor;
        if (Math.abs(this.amount() - amount) >= EPSILON)
            this.amount(amount);
    }
}

class ItemDemandSwitch {
    constructor(consumer, input, items, factor, assetsMap) {
        this.items = items;
        this.factor = factor;

        this.demands = [ // use array index to toggle
            new Demand({ guid: input.Product, "consumer": consumer }, assetsMap),
            new Demand({ guid: items[0].replacements.get(input.Product), "consumer": consumer }, assetsMap)
        ];
        this.amount = 0;

        this.items.forEach(item => item.checked.subscribe(() => this.updateAmount(this.amount)));
    }

    updateAmount(amount) {
        this.amount = amount;
        amount *= this.factor;
        this.demands.forEach((d, idx) => {
            let checked = this.items.map(item => item.checked()).reduce((a, b) => a || b);
            d.updateAmount(checked == idx ? amount : 0)
        });
    }

}

class ItemExtraDemand {
    constructor(consumer, input, items, factor, assetsMap) {
        this.items = items;
        this.factor = factor;

        this.demand = new Demand({ guid: items[0].replacements.get(input.Product), "consumer": consumer }, assetsMap);
        this.amount = 0;

        this.items.forEach(item => item.checked.subscribe(() => this.updateAmount(this.amount)));
    }

    updateAmount(amount) {
        this.amount = amount;
        amount *= this.factor
        let checked = this.items.map(item => item.checked()).reduce((a, b) => a || b);
        this.demand.updateAmount(checked ? amount : 0)
    }
}

class FactoryDemandSwitch {
    constructor(consumer, assetsMap) {
        this.consumer = consumer;
        this.factory = this.consumer.factory();

        this.demands = [];
        this.demandsMap = new Map();

        for (var factory of consumer.product.factories) {
            var factoryDemands = [];
            for (var input of factory.getInputs()) {
                var p = assetsMap.get(input.Product);
                if (p == null)
                    continue;

                var d;
                let items = factory.items.filter(item => item.replacements && item.replacements.has(input.Product));
                if (p.isAbstract) {
                    if (items.length)
                        d = new ItemExtraDemand(consumer, input, items, input.Amount || 1, assetsMap);
                } else {
                    if (items.length)
                        d = new ItemDemandSwitch(consumer, input, items, input.Amount || 1, assetsMap);
                    else
                        d = new Demand({ guid: input.Product, "consumer": consumer, "factor": input.Amount || 1 }, assetsMap);
                }

                if (d != null) {
                    factoryDemands.push(d);
                    this.demands.push(d);
                }
            }

            this.demandsMap.set(factory, factoryDemands);

        }

        this.amount = 0;

        this.consumer.factory.subscribe(factory => this.updateAmount(this.amount));
    }

    updateAmount(amount) {
        this.amount = amount;
        var factory = this.consumer.factory();

        for (var m of ["module", "fertilizerModule"]) {
            var module = factory[m];
            var checked = factory[m + "Checked"];
            if (module && checked() && module.additionalOutputCycle)
                amount *= module.additionalOutputCycle / (module.additionalOutputCycle + 1);
        }

        if (factory != this.factory) {
            for (var d of this.demandsMap.get(this.factory)) {
                d.updateAmount(0);
            }
        }

        this.factory = factory;


        for (var d of this.demandsMap.get(factory)) {
            d.updateAmount(amount);
        }

    }

}

class FactoryDemand extends Demand {
    constructor(config, assetsMap) {
        super(config, assetsMap);
        this.factory(config.factory);
    }

    updateFixedProductFactory() {
    }
}

class Need extends Demand {
    constructor(config, assetsMap) {
        super(config, assetsMap);
        this.allDemands = [];

        let treeTraversal = node => {
            if (node instanceof Demand && !(node instanceof Need))
                this.allDemands.push(node);
            (node.demands || []).forEach(treeTraversal);
        }
        treeTraversal(this);
    }

}

class PopulationNeed extends Need {
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

class BuildingMaterialsNeed extends Need {
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

class ResidenceBuilding extends NamedElement {
    constructor(config, assetsMap, island) {
        super(config);
        this.island = island;

        this.region = assetsMap.get(config.region)

        this.existingBuildings = createIntInput(0, 0);
        this.lockDLCIfSet(this.existingBuildings);
        this.limit = createIntInput(0, 0);
        this.limitLowerBound = config.residentMax;
        this.limitPerHouse = createFloatInput(this.limitLowerBound, this.limitLowerBound);
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

class PopulationLevel extends NamedElement {
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

            if (n.tpmin > 0 && product) {
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

class ProductCategory extends NamedElement {
    constructor(config, assetsMap) {
        super(config);
        this.products = config.products.map(p => assetsMap.get(p)).filter(p => p != null && p instanceof Product);
    }
}

class CommuterWorkforce extends NamedElement {
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

class Workforce extends NamedElement {
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

class WorkforceDemand extends NamedElement {
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

class WorkforceDemandSwitch extends WorkforceDemand {
    constructor(config, item, assetsMap) {
        super(config, assetsMap)
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

class Item extends NamedElement {
    constructor(config, assetsMap, region) {
        super(config);

        if (this.replaceInputs) {
            this.replacements = new Map();
            this.replacementArray = [];


            this.replaceInputs.forEach(r => {
                this.replacementArray.push({
                    old: assetsMap.get(r.OldInput),
                    new: assetsMap.get(r.NewInput)
                });
                this.replacements.set(r.OldInput, r.NewInput);
            });
        }

        this.factories = this.factories.map(f => assetsMap.get(f)).filter(f => !!f);

        if (this.additionalOutputs) {
            this.extraGoods = [];
            for (var p of this.additionalOutputs) {
                if (p.ForceProductSameAsFactoryOutput)
                    for (var f of this.factories)
                        this.extraGoods.push(assetsMap.get(f.getOutputs()[0].Product));
                else {
                    p = assetsMap.get(p.Product);
                    if (p)
                        this.extraGoods.push(p);
                }
            }
            this.availableExtraGoods = ko.pureComputed(() => this.extraGoods.filter(p => p.available()));
        }

        if (this.replacingWorkforce)
            this.replacingWorkforce = assetsMap.get(this.replacingWorkforce);


        this.equipments =
            this.factories.map(f => new EquippedItem({ item: this, factory: f, locaText: this.locaText, dlcs: config.dlcs }, assetsMap));
        this.availableEquipments = ko.pureComputed(() => this.equipments.filter(e => e.factory.available()));

        this.checked = ko.pureComputed({
            read: () => {
                for (var eq of this.equipments)
                    if (!eq.checked())
                        return false;

                return true;
            },
            write: (checked) => {
                this.equipments.forEach(e => e.checked(checked));
            }

        });

        this.visible = ko.computed(() => {
            if (!this.available() || this.availableEquipments().length == 0)
                return false;

            if (this.availableExtraGoods && this.availableExtraGoods().length == 0)
                return false;

            if (!view.island || !view.island())
                return true;

            var region = view.island().region;
            if (!region)
                return true;

            for (var f of this.factories)
                if (f.region === region)
                    return true;

            return false;
        });
    }
}

class EquippedItem extends Option {
    constructor(config, assetsMap) {
        super(config);

        this.lockDLCIfSet(this.checked);

        this.replacements = config.item.replacements;
        this.replacementArray = config.item.replacementArray;
        this.replacingWorkforce = config.item.replacingWorkforce;

        if (config.item.additionalOutputs) {
            this.extraGoods = []
            for (var cfg of config.item.additionalOutputs) {
                try {
                    var config = $.extend(true, {}, cfg, { item: this, factory: this.factory });
                    this.extraGoods.push(new ExtraGoodProduction(config, assetsMap));
                } catch (e) { }
            }
        }

        this.factory.items.push(this);

        this.visible = ko.pureComputed(() => {
            if (!this.available())
                return false;

            if (!view.island || !view.island())
                return true;

            var region = view.island().region;
            if (!region)
                return true;

            return this.factory.region === region;
        });
    }
}

class ExtraGoodProduction {
    constructor(config, assetsMap) {
        this.item = config.item;
        this.factory = config.factory;

        var product = config.ForceProductSameAsFactoryOutput ? config.factory.getOutputs()[0].Product : config.Product;
        this.product = assetsMap.get(product);
        if (!this.product)
            throw "Product " + product + " not found";

        this.additionalOutputCycle = config.AdditionalOutputCycle;
        this.Amount = config.Amount;

        this.amount = ko.computed(() => !!this.item.checked() * config.Amount * (this.factory.clipped && this.factory.clipped() ? 2 : 1) * this.factory.outputAmount() / this.additionalOutputCycle);

        for (var f of this.product.factories) {
            f.extraGoodProductionList.entries.push(this);

            if (f == this.factory)
                f.extraGoodProductionList.selfEffecting.push(this);
        }
    }
}

class ExtraGoodProductionList {
    constructor(factory) {
        this.factory = factory;

        this.checked = ko.observable(true);
        this.selfEffecting = ko.observableArray();

        this.entries = ko.observableArray();
        this.nonZero = ko.computed(() => {
            return this.entries().filter(i => i.amount());
        });
        this.amount = ko.computed(() => {
            var total = 0;
            for (var i of (this.entries() || []))
                if (this.selfEffecting.indexOf(i) == -1) // self effects considered in factory.extraGoodFactor
                    total += i.amount();

            return total;
        });
        this.amountWithSelf = ko.computed(() => {
            var total = 0;
            for (var i of (this.entries() || []))
                total += i.amount();

            return total;
        })
    }
}

class GoodConsumptionUpgrade extends Option {
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

class NewspaperNeedConsumption {
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

class NewspaperNeedConsumptionEntry extends Option {
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

class GoodConsumptionUpgradeIslandList {
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

class TradeRoute {
    constructor(config) {
        $.extend(this, config);

        this.amount = createFloatInput(0, 0);
        this.amount(config.amount);
    }

    getOpposite(list) {
        if (list.island == this.from)
            return this.to;
        else
            return this.from;
    }

    getOppositeFactory(factory) {
        if (this.fromFactory == factory)
            return this.toFactory;
        else
            return this.fromFactory;
    }

    isExport(list) {
        return list.island == this.from;
    }

    delete() {
        view.tradeManager.remove(this);
    }
}

class NPCTrader extends NamedElement {
    constructor(config) {
        super(config);
    }
}

class NPCTradeRoute {
    constructor(config) {
        $.extend(this, config);

        this.amount = this.ProductionPerMinute;
        this.checked = ko.observable(false);
        this.checked.subscribe(checked => {
            if (view.tradeManager) {
                if (checked)
                    view.tradeManager.npcRoutes.push(this);
                else
                    view.tradeManager.npcRoutes.remove(this);
            }
        });
    }
}

class TradeList {
    constructor(island, factory) {
        this.island = island;
        this.factory = factory;

        this.routes = ko.observableArray();
        if (this.factory.outputs) {
            var traders = view.productsToTraders.get(this.factory.outputs[0].Product);
            if (traders)
                this.npcRoutes = traders.map(t => new NPCTradeRoute($.extend({}, t, { to: island, toFactory: factory })));
        }

        this.amount = ko.computed(() => {
            var amount = 0;

            for (var route of (this.npcRoutes || [])) {
                amount -= route.checked() ? route.amount : 0;
            }

            for (var route of this.routes()) {
                amount += (route.isExport(this) ? 1 : -1) * route.amount();
            }

            return amount;
        });

        // interface elements to create a new route
        this.unusedIslands = ko.observableArray();
        this.selectedIsland = ko.observable();
        this.export = ko.observable(false);
        this.newAmount = ko.observable(0);
    }

    canCreate() {
        return this.selectedIsland() && !this.selectedIsland().isAllIslands() && this.newAmount();
    }

    create() {
        if (!this.canCreate())
            return;

        var otherFactory;
        for (var f of this.selectedIsland().factories)
            if (f.guid == this.factory.guid) {
                otherFactory = f;
                break;
            }

        if (!otherFactory)
            return;

        if (this.export()) {
            var route = new TradeRoute({
                from: this.island,
                to: this.selectedIsland(),
                fromFactory: this.factory,
                toFactory: otherFactory,
                amount: this.newAmount()
            });
        } else {
            var route = new TradeRoute({
                to: this.island,
                from: this.selectedIsland(),
                toFactory: this.factory,
                fromFactory: otherFactory,
                amount: this.newAmount()
            });
        }

        this.routes.push(route);
        this.unusedIslands.remove(this.selectedIsland());
        otherFactory.tradeList.routes.push(route);

        view.tradeManager.add(route);
    }

    onShow() {
        var usedIslands = new Set(this.routes().flatMap(r => [r.from, r.to]));
        var islands = view.islands().slice(1).filter(i => !usedIslands.has(i) && i != this.island);
        islands.sort((a, b) => {
            var sIdxA = view.sessions.indexOf(a.session);
            var sIdxB = view.sessions.indexOf(b.session);

            if (sIdxA == sIdxB) {
                return a.name().localeCompare(b.name());
            } else {
                return sIdxA - sIdxB;
            }
        });
        var overProduction = this.factory.overProduction();
        if (overProduction == 0)
            overProduction = -this.factory.computedExtraAmount();
        this.export(overProduction > 0);
        this.newAmount(Math.abs(overProduction));

        this.unusedIslands(islands);
    }
}

class TradeManager {
    constructor() {
        this.key = "tradeRoutes";
        this.npcKey = "npcTradeRoutes";
        this.npcRoutes = ko.observableArray();
        this.routes = ko.observableArray();

        view.selectedFactory.subscribe(f => {
            if (!(f instanceof Factory))
                return;

            if (f.tradeList)
                f.tradeList.onShow();
        });



        if (localStorage) {
            // trade routes
            var islands = new Map();
            for (var i of view.islands())
                if (!i.isAllIslands())
                    islands.set(i.name(), i);

            var resolve = name => name == ALL_ISLANDS ? view.islandManager.allIslands : islands.get(name);

            var text = localStorage.getItem(this.key);
            var json = text ? JSON.parse(text) : [];
            for (var r of json) {
                var config = {
                    from: resolve(r.from),
                    to: resolve(r.to),
                    amount: parseFloat(r.amount)
                };

                if (!config.from || !config.to)
                    continue;

                config.fromFactory = config.from.assetsMap.get(r.factory);
                config.toFactory = config.to.assetsMap.get(r.factory);

                if (!config.fromFactory || !config.toFactory)
                    continue;

                var route = new TradeRoute(config);
                this.routes.push(route);
                config.fromFactory.tradeList.routes.push(route);
                config.toFactory.tradeList.routes.push(route);
            }


            this.persistenceSubscription = ko.computed(() => {
                var json = [];

                for (var r of this.routes()) {
                    json.push({
                        from: r.from.isAllIslands() ? ALL_ISLANDS : r.from.name(),
                        to: r.to.isAllIslands() ? ALL_ISLANDS : r.to.name(),
                        factory: r.fromFactory.guid,
                        amount: r.amount()
                    });
                }

                localStorage.setItem(this.key, JSON.stringify(json, null, 4));

                return json;
            });

            // npc trade routes
            text = localStorage.getItem(this.npcKey);
            json = text ? JSON.parse(text) : [];
            for (var r of json) {
                var to = resolve(r.to);

                if (!to)
                    continue;

                var factory = to.assetsMap.get(r.factory);
                if (!factory)
                    continue;

                factory.tradeList.npcRoutes.forEach(froute => {
                    if (froute.trader.guid === r.trader) {
                        froute.checked(true);
                        this.add(froute);
                    }
                });
            }


            this.npcPersistenceSubscription = ko.computed(() => {
                var json = [];

                for (var r of this.npcRoutes()) {
                    json.push({
                        trader: r.trader.guid,
                        to: r.to.isAllIslands() ? ALL_ISLANDS : r.to.name(),
                        factory: r.toFactory.guid
                    });
                }

                localStorage.setItem(this.npcKey, JSON.stringify(json, null, 4));

                return json;
            });
        }
    }

    add(route) {
        if (route instanceof NPCTradeRoute)
            this.npcRoutes.push(route);
        else
            this.routes.push(route);
    }

    remove(route) {
        if (route instanceof NPCTradeRoute) {
            this.npcRoutes.remove(route);
            route.checked(false);
            return;
        }

        route.fromFactory.tradeList.routes.remove(route);
        route.toFactory.tradeList.routes.remove(route);
        this.routes.remove(route);

        route.toFactory.tradeList.unusedIslands.unshift(route.from);
        route.fromFactory.tradeList.unusedIslands.unshift(route.to);
    }

    islandDeleted(island) {
        {
            var deletedRoutes = this.routes().filter(r => r.to === island || r.from === island);
            deletedRoutes.forEach(r => this.remove(r));
        }

        {
            var deletedRoutes = this.npcRoutes().filter(r => r.to === island);
            deletedRoutes.forEach(r => this.remove(r));
        }
    }
}

class Pier extends NamedElement {
    constructor(config) {
        super(config);
    }
}

class TradeContract {
    constructor(config) {
        $.extend(this, config);

        this.exportProduct = this.exportFactory.product;
        this.importProduct = this.importFactory.product;

        this.importAmount = createFloatInput(0, 0);

        this.ratio = ko.computed(() => {
            return (this.importProduct.agio || 1) * this.importProduct.exchangeWeight /
                this.exportProduct.exchangeWeight /
                (view.contractUpgradeManager.upgradesMap().get(this.exportProduct.guid) || 1);
        });

        this.exportAmount = ko.pureComputed({
            read: () => this.ratio() * this.importAmount(),
            write: val => this.importAmount(parseFloat(val) / this.ratio())
        });

        if (config.importAmount)
            this.importAmount(config.importAmount);
        else
            this.exportAmount(config.exportAmount);

        this.importCount = ko.observable(0);
        this.exportCount = ko.observable(0);
        this.fixed = ko.observable(this.fixed || false);
    }

    delete() {
        this.importFactory.island.contractManager.remove(this);
    }
}

class ContractList {
    constructor(island, factory) {
        this.island = island;
        this.factory = factory;

        this.imports = ko.observableArray();
        this.exports = ko.observableArray();


        this.amount = ko.computed(() => {
            var amount = 0;

            for (var contract of this.imports()) {
                amount -= contract.importAmount();
            }

            for (var contract of this.exports()) {
                amount += contract.exportAmount();
            }

            return amount;
        });

    }
}

class ContractManager {
    constructor(island) {
        this.key = "tradingContracts";
        this.paramKey = "tradingContractParams";
        this.island = island;
        this.contracts = ko.observableArray();
        this.contractsLength = ko.pureComputed(() => this.contracts().length);

        var dlc = view.dlcsMap.get("dlc7");
        if (dlc) {
            dlc.addDependentObject(this.contractsLength);
        }

        var localStorage = island.storage;
        if (localStorage) {
            // trade routes
            var assetsMap = island.assetsMap;

            var text = localStorage.getItem(this.key);
            var json = text ? JSON.parse(text) : [];
            for (var r of json) {
                var config = {
                    importFactory: assetsMap.get(r.importFactory),
                    exportFactory: assetsMap.get(r.exportFactory),
                    importAmount: parseFloat(r.importAmount),
                    fixed: r.fixed
                };

                if (!config.importFactory || !config.exportFactory || !config.importFactory.contractList || !config.exportFactory.contractList)
                    continue;

                var contract = new TradeContract(config);
                this.contracts.push(contract);
                config.importFactory.contractList.imports.push(contract);
                config.exportFactory.contractList.exports.push(contract);
            }


            this.persistenceSubscription = ko.computed(() => {
                var json = [];

                for (var r of this.contracts()) {
                    json.push({
                        importFactory: r.importFactory.guid,
                        exportFactory: r.exportFactory.guid,
                        importAmount: r.importAmount(),
                        fixed: r.fixed() ? 1 : 0
                    });
                }

                localStorage.setItem(this.key, JSON.stringify(json, null, 4));

                return json;
            });

        }

        this.traderLoadingSpeed = createFloatInput(2, 1, 50);
        this.existingStorageCapacity = createIntInput(2000, 100, 50000);
        this.traderTransferTime = createIntInput(params.tradeContracts.traderTransferMinutes + 4, 20)

        if (localStorage) {
            {
                let id = "traderLoadingSpeed.amount";
                if (localStorage.getItem(id) != null)
                    this.traderLoadingSpeed(parseFloat(localStorage.getItem(id)));

                this.traderLoadingSpeed.subscribe(val => localStorage.setItem(id, val));
            }

            {
                let id = "existingStorageCapacity.amount";
                if (localStorage.getItem(id) != null)
                    this.existingStorageCapacity(parseInt(localStorage.getItem(id)));

                this.existingStorageCapacity.subscribe(val => localStorage.setItem(id, val));
            }

            {
                let id = "traderTransferTime.amount";
                if (localStorage.getItem(id) != null)
                    this.traderTransferTime(parseInt(localStorage.getItem(id)));

                this.traderTransferTime.subscribe(val => localStorage.setItem(id, val));
            }
        }

        this.traderLoadingDuration = ko.computed(() => {
            var totalAmount = 0;
            for (var c of this.contracts())
                totalAmount += c.importAmount() + c.exportAmount();

            var transferTime = this.traderTransferTime();

            if (totalAmount >= 60 * this.traderLoadingSpeed() * params.tradeContracts.loadingSpeedFactor) {
                for (var c of this.contracts()) {
                    c.importCount(Infinity);
                    c.exportCount(Infinity);
                }

                return Infinity;
            }

            var x = totalAmount / (60 * this.traderLoadingSpeed() * params.tradeContracts.loadingSpeedFactor);
            var loadingDuration = Math.max(params.tradeContracts.minimumLoadingTime / 60, - transferTime * x / (x - 1));
            var totalDuration = transferTime + loadingDuration;

            for (var c of this.contracts()) {
                c.importCount(Math.ceil(c.importAmount() * totalDuration));
                c.exportCount(Math.ceil(c.exportAmount() * totalDuration));
            }

            return loadingDuration;
        });

        this.totalAmount = ko.pureComputed(() => {
            var sum = 0;

            for (var c of this.contracts())
                sum += c.importAmount() + c.exportAmount();

            return sum;
        });

        this.storageCapacity = ko.pureComputed(() => {
            var productToCount = new Map();

            for (var c of this.contracts()) {
                // import
                var guid = c.importProduct.guid;
                if (productToCount.has(guid))
                    productToCount.set(guid, c.importCount() + productToCount.get(guid));
                else
                    productToCount.set(guid, c.importCount());

                // export
                guid = c.exportProduct.guid;
                if (productToCount.has(guid))
                    productToCount.set(guid, c.exportCount() + productToCount.get(guid));
                else
                    productToCount.set(guid, c.exportCount());

            }

            if (!productToCount.size)
                return 0;

            var m = 0;
            for (var val of productToCount.values())
                if (val > m)
                    m = val;

            return m;
        });

    }

    add(contract) {
        this.contracts.push(contract);
    }

    remove(contract) {
        contract.importFactory.contractList.imports.remove(contract);
        contract.exportFactory.contractList.exports.remove(contract);
        this.contracts.remove(contract);
    }

    islandDeleted(island) {
        var dlc = view.dlcsMap.get("dlc7");
        if (dlc) {
            dlc.removeDependentObject(this.contractsLength);
        }
    }

    setStorageCapacity() {
        if (!this.contracts().length)
            return;

        var transferTime = this.traderTransferTime();

        var getAmounts = (fixed) => {
            var totalAmount = 0;
            var productToAmount = new Map();
            for (var c of this.contracts()) {
                if (fixed != c.fixed())
                    continue;

                var importAmount = c.importAmount() || ACCURACY;
                var exportAmount = c.exportAmount() || (ACCURACY * c.ratio());
                totalAmount += importAmount + exportAmount;

                // import
                var guid = c.importProduct.guid;
                if (productToAmount.has(guid))
                    productToAmount.set(guid, importAmount + productToAmount.get(guid));
                else
                    productToAmount.set(guid, importAmount);

                // export
                guid = c.exportProduct.guid;
                if (productToAmount.has(guid))
                    productToAmount.set(guid, exportAmount + productToAmount.get(guid));
                else
                    productToAmount.set(guid, exportAmount);
            }

            var maxAmount = 0;
            var maximizer = 0;
            for (var key of productToAmount.keys()) {
                var val = productToAmount.get(key);
                if (val > maxAmount) {
                    maxAmount = val;
                    maximizer = key;
                }
            }

            return {
                "max": maxAmount,
                "maximizer": maximizer,
                "total": totalAmount,
                "perProduct": productToAmount
            };
        };

        var fixedAmounts = getAmounts(true);
        var volatileAmounts = getAmounts(false);

        if (volatileAmounts.total == 0)
            return;

        var s = 60 * this.traderLoadingSpeed() * params.tradeContracts.loadingSpeedFactor;
        var c = this.existingStorageCapacity();

        //x = newTotalAmount / s
        //existingStorageCapactiy = newMaxAmount * (loadingDuration + transferTime) 
        //    = newMaxAmount * (-transferTime * x/(x-1) + transferTime)
        //    = newMaxAmount * (- transferTime * (newTotalAmount / s) / ((newTotalAmount / s) - 1) + transferTime)
        //    = f * maxAmount * (- transferTime * (f * totalAmount / s) / ((f * totalAmount / s) - 1) + transferTime)

        if (fixedAmounts.total == 0) {
            var f = c * s / (volatileAmounts.max * s * transferTime + c * volatileAmounts.total);

            for (var c of this.contracts()) {
                c.importAmount(f * (c.importAmount() || ACCURACY));
            }
            // fixed contracts exceed capacity
        } else if (s * c <= fixedAmounts.max *s * transferTime + c * fixedAmounts.total + ACCURACY) {
            for (var c of this.contracts()) {
                if (!c.fixed())
                    c.importAmount(0 * c.importAmount());
            }
        } else {
            var prevGuid = 0;
            var prevF = 0;
            var guid = fixedAmounts.maximizer;
            var f = 1;

            while (prevGuid != guid && Math.abs(f - prevF) > ACCURACY) {
                var maxFixed = fixedAmounts.perProduct.get(guid) || 0;
                var maxVolatile = volatileAmounts.perProduct.get(guid) || 0;
                prevF = f;

                f = (-maxFixed * s * transferTime + s * c - c * fixedAmounts.total) / (maxVolatile * s * transferTime + c * volatileAmounts.total);

                var maxAmount = maxFixed + f * maxVolatile;
                prevGuid = guid;

                for (var g of volatileAmounts.perProduct.keys()) {
                    var amount = f * volatileAmounts.perProduct.get(g) + (fixedAmounts.perProduct.get(g) || 0);

                    if (amount > maxAmount + ACCURACY) {
                        maxAmount = amount;
                        guid = g;
                    }
                }
            }

            for (var c of this.contracts()) {
                if (!c.fixed())
                    c.importAmount(f * (c.importAmount() || ACCURACY));
            }
        }
    }
}

class ContractUpgrade {
    constructor(config) {
        $.extend(this, config);
    }

    delete() {
        view.contractUpgradeManager.upgrades.remove(this);
    }
}

class ContractUpgradeManager {
    constructor() {
        this.key = "contractUpgrades";
        this.upgrades = ko.observableArray();

        this.productsMap = new Map();
        var assetsMap = new Map();
        for (var p of params.products)
            if (p.exchangeWeight)
                this.productsMap.set(p.guid, new Product(p, assetsMap));


        if (localStorage) {

            var text = localStorage.getItem(this.key);
            var json = text ? JSON.parse(text) : {};
            for (var p in json) {
                var config = {
                    product: this.productsMap.get(parseInt(p)),
                    factor: json[p],
                };

                this.upgrades.push(new ContractUpgrade(config));
            }


            this.persistenceSubscription = ko.computed(() => {
                var json = {};

                for (var u of this.upgrades()) {
                    json[u.product.guid] = u.factor;
                }

                localStorage.setItem(this.key, JSON.stringify(json));

                return json;
            });

        }

        this.sortUpgrades();

        this.upgradesMap = ko.pureComputed(() => {
            var map = new Map();
            for (var u of this.upgrades())
                map.set(u.product.guid, u.factor);

            return map;
        });

        this.products = ko.computed(() => {
            return [...this.productsMap.values()]
                .filter(p => !this.upgradesMap().has(p.guid))
                .sort((a, b) => a.name().localeCompare(b.name()));
        });
        this.product = ko.observable(null);
        this.factors = ko.computed(() => {
            var factorToAmount = new Map();

            for (var u of params.tradeContracts.upgrades)
                factorToAmount.set(u.factor, 0);

            for (var u of this.upgrades())
                factorToAmount.set(u.factor, factorToAmount.get(u.factor) + 1);

            return params.tradeContracts.upgrades.filter(u => factorToAmount.get(u.factor) < u.maximumAllowedGoods).map(u => u.factor);
        });
        this.factor = ko.observable(this.factors[0]);

        this.canCreate = ko.pureComputed(() => this.product() && this.factor());
    }

    create() {
        this.upgrades.push(new ContractUpgrade({
            product: this.product(),
            factor: this.factor()
        }));

        this.sortUpgrades();
    }

    sortUpgrades() {
        this.upgrades.sort((a, b) => {
            if (a.factor != b.factor)
                return b.factor - a.factor;

            return a.product.name().localeCompare(b.product.name());
        });
    }
}

class ContractCreatorFactory {
    constructor() {
        // interface elements to create a new contract in factory config dialog
        this.export = ko.observable(false);

        this.exchangeProducts = ko.computed(() => {
            if (!view.selectedFactory() || !view.selectedFactory().contractList)
                return [];

            var f = view.selectedFactory();
            var fl = f.contractList;
            var i = fl.island
            var il = i.contractManager.contracts();

            var usedProducts = [f.product]
            if (this.export())
                usedProducts = usedProducts.concat(fl.exports().map(c => c.importProduct))
            else
                usedProducts = usedProducts.concat(fl.imports().map(c => c.exportProduct));

            if (!i.isAllIslands())
                if (this.export())
                    usedProducts = usedProducts.concat(il.map(c => c.exportProduct))
                else
                    usedProducts = usedProducts.concat(il.map(c => c.importProduct))

            usedProducts = new Set(usedProducts);
            usedProducts.add(f.product);

            var list;
            if (this.export())
                list = i.products
                    .filter(p => p.guid != 1010566 && p.guid != 270042 && p.canImport && !usedProducts.has(p) && p.available());
            else
                list = i.products
                    .filter(p => p.guid != 1010566 && p.guid != 270042 && !usedProducts.has(p) && p.available());

            return list.sort((a, b) => a.name().localeCompare(b.name()));
        });
        this.exchangeProduct = ko.observable(null);

        this.exchangeFactories = ko.computed(() => {
            var list;
            if (this.exchangeProduct())
                list = this.exchangeProduct().factories;
            else
                list = this.exchangeProducts().flatMap(p => p.factories);


            return list.sort((a, b) => a.getRegionExtendedName().localeCompare(b.getRegionExtendedName()));
        });
        this.exchangeFactory = ko.observable();
        this.exchangeFactory.subscribe(f => this.exchangeProduct(f ? f.product : null));

        this.newAmount = createFloatInput(0, 0);

        this.contractList = ko.pureComputed(() => {
            return view.selectedFactory().contractList;
        });

        this.canImport = ko.pureComputed(() => {
            var f = view.selectedFactory();

            return !!(f.product.canImport && (f.contractList.island.isAllIslands() || !f.contractList.exports().length));
        });

        this.canExport = ko.pureComputed(() => {
            var f = view.selectedFactory();

            return !!(f.contractList.island.isAllIslands() || !f.contractList.imports().length);
        });

        view.selectedFactory.subscribe(f => {
            if (!(f instanceof Factory) || !f.contractList)
                return;

            var overProduction = f.overProduction();
            if (overProduction == 0)
                overProduction = -f.computedExtraAmount();

            if (!f.contractList.island.isAllIslands() && f.contractList.exports().length) {
                this.export(true);
                this.newAmount(Math.max(0, overProduction));
            } else if (f.contractList.imports().length) {
                this.export(false);
                this.newAmount(Math.abs(Math.min(0, overProduction)));
            } else {
                if (overProduction < 0 &&
                    (f.product.canImport && (f.contractList.island.isAllIslands() || !f.contractList.exports().length))) {
                    // do not use this.canImport() since it may not be updated yet
                    this.export(false);
                    this.newAmount(Math.abs(overProduction));
                } else {
                    this.export(true);
                    this.newAmount(Math.max(0, overProduction));
                }
            }
        });
    }

    canCreate() {
        return this.exchangeFactory() && this.newAmount() && (this.export() || this.canImport()) && this.exchangeFactory().getProduct().exchangeWeight && view.selectedFactory().getProduct().exchangeWeight;
    }

    create() {
        if (!this.canCreate())
            return;

        var f = view.selectedFactory();
        var l = f.contractList;
        if (!l)
            return;

        var otherF = this.exchangeFactory();

        if (this.export()) {
            var contract = new TradeContract({
                exportFactory: f,
                importFactory: otherF,
                exportAmount: this.newAmount()
            });

            l.exports.push(contract);
            otherF.contractList.imports.push(contract);
        } else {
            var contract = new TradeContract({
                exportFactory: otherF,
                importFactory: f,
                importAmount: this.newAmount()
            });

            l.imports.push(contract);
            otherF.contractList.exports.push(contract);
        }

        l.island.contractManager.add(contract);
    }
}

class RecipeList extends NamedElement {
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

class ProductionChainView {
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

class PopulationReader {

    constructor() {
        this.url = 'http://localhost:8000/AnnoServer/Population';
        this.notificationShown = false;
        this.currentVersion;
        this.recentVersion;

        // only ping the server when the website is run locally
        if (isLocal()) {
            console.log('waiting for responses from ' + this.url);
            this.requestInterval = setInterval(this.handleResponse.bind(this), 1000);

            $.getJSON("https://api.github.com/repos/NiHoel/Anno1800UXEnhancer/releases/latest").done((release) => {
                this.recentVersion = release.tag_name;
                this.checkVersion();
            });
        }
    }

    async handleResponse() {
        var url_with_params = this.url + "?" +
            jQuery.param({
                lang: view.settings.language(),
                //                optimalProductivity: view.settings.optimalProductivity.checked()
            });

        try {
            const response = await fetch(url_with_params);
            const json = await response.json(); //extract JSON from the http response

            if (!json)
                return;

            if (json.version) {
                this.currentVersion = json.version;
                this.checkVersion();
            }


            if (view.settings.proposeIslandNames.checked()) {
                for (var isl of (json.islands || [])) {
                    view.islandManager.registerName(isl.name, view.assetsMap.get(isl.session));
                }
            }

            var island = null;
            if (json.islandName) {
                island = view.islandManager.getByName(json.islandName);
            }

            if (!island)
                return;

            if (view.settings.updateSelectedIslandOnly.checked() && island != view.island())
                return;


            for (let key in json) {
                let asset = island.assetsMap.get(parseInt(key));
                if (asset instanceof PopulationLevel) {
                    if (asset.floorsSummedExistingBuildings && asset.hasSkyscrapers()) {
                        continue; // do not update summary values if skyscrapers are used
                    }

                    if (json[key].existingBuildings && view.settings.populationLevelExistingBuildings.checked()) {
                        asset.residence.existingBuildings(json[key].existingBuildings);
                        asset.existingBuildings(json[key].existingBuildings);


                        if (json[key].limit && view.settings.populationLevelLimit.checked()) {
                            asset.residence.limitPerHouse(json[key].limit / json[key].existingBuildings);
                            asset.limitPerHouse(json[key].limit / json[key].existingBuildings);
                        }

                        if (json[key].amount && view.settings.populationLevelAmount.checked()) {
                            view.settings.deriveResidentsPerHouse.checked(false);
                            asset.amountPerHouse(json[key].amount / json[key].existingBuildings);
                        }
                    }

                    if (json[key].limit && view.settings.populationLevelLimit.checked()) {
                        asset.limit(json[key].limit);
                    }

                    if (json[key].amount && view.settings.populationLevelAmount.checked()) {
                        asset.amount(json[key].amount);
                    }

                } else if (asset instanceof Consumer) {
                    if (json[key].existingBuildings && view.settings.factoryExistingBuildings.checked())
                        asset.existingBuildings(parseInt(json[key].existingBuildings));

                    if (view.settings.factoryPercentBoost.checked()) {
                        if (view.settings.optimalProductivity.checked()) {
                            if (asset.existingBuildings() && json[key].limit) {

                                var limit = Math.max(0, json[key].limit - asset.extraGoodProductionList.amount());

                                if (asset.getOutputs().length && asset.getOutputs()[0].product.producers.length > 1) {

                                    // in all islands view, multiple factories can be produce one good
                                    // the server stored the same values for all of these factories
                                    // we consider them together and sum their existing buildings

                                    var factories = [];
                                    var countBuildings = 0;

                                    for (var guid of asset.getOutputs()[0].product.producers) {
                                        var factory = island.assetsMap.get(guid);

                                        if (factory.existingBuildings() && json[guid]) {
                                            factories.push(factory);
                                            countBuildings += factory.existingBuildings() * factory.extraGoodFactor() * factory.tpmin;
                                        }
                                    }

                                    var percentBoost = 100 * limit / countBuildings;
                                    if (countBuildings == 0 || percentBoost < 50 || percentBoost >= 1000)
                                        continue;

                                    for (var factory of factories)
                                        factory.percentBoost(percentBoost);
                                }
                                else {
                                    var percentBoost = 100 * limit / asset.existingBuildings() / asset.tpmin / asset.extraGoodFactor();
                                    if (percentBoost >= 50 && percentBoost < 1000)
                                        asset.percentBoost(percentBoost);
                                }
                            }

                        }
                        else if (json[key].percentBoost)
                            asset.percentBoost(parseInt(json[key].percentBoost));
                    }

                } else if (asset instanceof ResidenceBuilding) {
                    if (json[key].existingBuildings)
                        asset.existingBuildings(parseInt(json[key].existingBuildings));
                }

            }
        } catch (e) {
        }
    }

    checkVersion() {
        if (!this.notificationShown && this.recentVersion && this.currentVersion && this.recentVersion !== this.currentVersion) {
            this.notificationShown = true;
            $.notify({
                // options
                message: view.texts.serverUpdate.name()
            }, {
                // settings
                type: 'warning',
                placement: { align: 'center' }
            });
        }
    }


}

class IslandManager {
    constructor(params, isFirstRun = false) {
        let islandKey = "islandName";
        let islandsKey = "islandNames";

        // used for creation and renaming
        this.islandNameInput = ko.observable();
        this.availableSessions = ko.pureComputed(() => view.sessions.filter(s => s.available()))
        this.sessionInput = ko.observable(view.sessions[0]);
        this.params = params;
        this.islandCandidates = ko.observableArray();
        this.unusedNames = new Set();
        this.serverNamesMap = new Map();
        this.renameIsland = ko.observable();

        this.showIslandOnCreation = new Option({
            name: "Show Island on Creation",
            locaText: texts.showIslandOnCreation
        });
        this.showIslandOnCreation.checked(true);

        var islandNames = [];
        if (localStorage && localStorage.getItem(islandsKey))
            islandNames = JSON.parse(localStorage.getItem(islandsKey))

        var islandName = localStorage.getItem(islandKey);
        view.islands = ko.observableArray();
        view.island = ko.observable();

        view.island.subscribe(isl => window.document.title = isl.name());

        for (var name of islandNames) {
            var island = new Island(params, new Storage(name), false);
            view.islands.push(island);
            this.serverNamesMap.set(island.name(), island);

            if (name == islandName)
                view.island(island);
        }

        this.sortIslands();

        var allIslands = new Island(params, localStorage, isFirstRun);
        this.allIslands = allIslands;
        view.islands.unshift(allIslands);
        this.serverNamesMap.set(allIslands.name(), allIslands);
        if (!view.island())
            view.island(allIslands);



        if (localStorage) {
            view.islands.subscribe(islands => {
                let islandNames = JSON.stringify(islands.filter(i => !i.isAllIslands()).map(i => i.name()));
                localStorage.setItem(islandsKey, islandNames);
            });

            this.currentIslandSubscription = ko.computed(() => {
                var name = view.island().name();
                localStorage.setItem(islandKey, name);
            });
        }

        this.islandExists = ko.computed(() => {
            var name = this.islandNameInput();
            if (!name || name == ALL_ISLANDS || name == view.texts.allIslands.name())
                return true;

            return this.serverNamesMap.has(name) && this.serverNamesMap.get(name).name() == name;
        });
    }

    create(name, session) {
        if (name == null) {
            if (this.islandExists())
                return;

            name = this.islandNameInput();
        }

        if (this.serverNamesMap.has(name) && this.serverNamesMap.get(name).name() == name)
            return;

        var island = new Island(this.params, new Storage(name), true, session);
        view.islands.push(island);
        this.sortIslands();

        if (this.showIslandOnCreation.checked())
            view.island(island);

        this.serverNamesMap.set(name, island);
        var removedCandidates = this.islandCandidates.remove(i => !isNaN(this.compareNames(i.name, name)));
        for (var c of removedCandidates) {
            this.unusedNames.delete(c.name);
            this.serverNamesMap.set(c.name, island);
        }

        if (name == this.islandNameInput())
            this.islandNameInput(null);
    }

    delete(island) {
        if (island == null)
            island = view.island();

        if (island.name() == ALL_ISLANDS || island.isAllIslands())
            return;

        if (view.island() == island)
            view.island(view.islands()[0]);

        if (view.tradeManager) {
            view.tradeManager.islandDeleted(island);
        }

        for (var a of island.assetsMap.values())
            if (a instanceof NamedElement)
                a.delete();

        view.islands.remove(island);
        island.session.deleteIsland(island);
        if (localStorage)
            localStorage.removeItem(island.name());

        for (var entry of this.serverNamesMap.entries()) {
            if (entry[1] == island)
                this.serverNamesMap.set(entry[0], null);
        }

        this.serverNamesMap.delete(island.name());
        this.unusedNames.add(island.name());
        this.islandCandidates.push({ name: island.name(), session: island.session });
        this.sortUnusedNames();
    }

    rename(island, name) {
        if (this.islandExists())
            return;

        if (this.serverNamesMap.has(name) && this.serverNamesMap.get(name).name() == name)
            return;

        for (var entry of this.serverNamesMap.entries()) {
            if (entry[1] == island)
                this.serverNamesMap.set(entry[0], null);
        }

        this.serverNamesMap.delete(island.name());
        this.unusedNames.add(island.name());
        this.islandCandidates.push({ name: island.name(), session: island.session });

        island.name(name);
        this.sortIslands();

        this.serverNamesMap.set(name, island);
        var removedCandidates = this.islandCandidates.remove(i => !isNaN(this.compareNames(i.name, name)));
        for (var c of removedCandidates) {
            this.unusedNames.delete(c.name);
            this.serverNamesMap.set(c.name, island);
        }

        this.islandNameInput(null);
        this.sortUnusedNames();
    }

    startRename(island) {
        if (island.isAllIslands())
            return;

        this.renameIsland(island);
        this.islandNameInput(island.name());
        $('#island-rename-dialog').modal("show");
    }

    deleteCandidate(candidate) {
        this.unusedNames.delete(candidate.name);
        this.islandCandidates.remove(candidate);
    }

    getByName(name) {
        return name == ALL_ISLANDS ? this.allIslands : this.serverNamesMap.get(name);
    }

    registerName(name, session) {
        if (name == ALL_ISLANDS || this.serverNamesMap.has(name))
            return;

        if (this.unusedNames.has(name))
            return;

        var island = null;
        var bestMatch = 0;

        for (var isl of view.islands()) {
            var match = this.compareNames(isl.name(), name);
            if (!isNaN(match) && match > bestMatch) {
                island = isl;
                bestMatch = match;
            }
        }

        if (island) {
            this.serverNamesMap.set(name, island);
            var removedCandidates = this.islandCandidates.remove(i => i.name === name);
            for (var c of removedCandidates)
                this.unusedNames.delete(c.name);
            return;
        }

        this.islandCandidates.push({ name: name, session: session });
        this.unusedNames.add(name);
        this.sortUnusedNames();
    }

    compareNames(name1, name2) {
        var totalLength = Math.max(name1.length, name2.length);
        var minLcsLength = totalLength - Math.round(-0.677 + 1.51 * Math.log(totalLength));
        var lcsLength = this.lcsLength(name1, name2);

        if (lcsLength >= minLcsLength)
            return lcsLength / totalLength;
        else
            return NaN;
    }

    sortIslands() {
        view.islands.sort((a, b) => {
            if (a.isAllIslands() || a.name() == ALL_ISLANDS)
                return -Infinity;
            else if (b.isAllIslands() || b.name() == ALL_ISLANDS)
                return Infinity;

            var sIdxA = view.sessions.indexOf(a.session);
            var sIdxB = view.sessions.indexOf(b.session);

            if (sIdxA == sIdxB) {
                return a.name().localeCompare(b.name());
            } else {
                return sIdxA - sIdxB;
            }
        });
    }

    sortUnusedNames() {
        this.islandCandidates.sort((a, b) => {
            var sIdxA = view.sessions.indexOf(a.session);
            var sIdxB = view.sessions.indexOf(b.session);

            if (sIdxA == sIdxB) {
                return a.name.localeCompare(b.name);
            } else {
                return sIdxA - sIdxB;
            }
        });
    }

    // Function to find length of Longest Common Subsequence of substring
    // X[0..m-1] and Y[0..n-1]
    // From https://www.techiedelight.com/longest-common-subsequence/
    lcsLength(X, Y) {
        var m = X.length, n = Y.length;

        // lookup table stores solution to already computed sub-problems
        // i.e. lookup[i][j] stores the length of LCS of substring
        // X[0..i-1] and Y[0..j-1]
        var lookup = [];
        for (var i = 0; i <= m; i++)
            lookup.push(new Array(n + 1).fill(0));

        // fill the lookup table in bottom-up manner
        for (var i = 1; i <= m; i++) {
            for (var j = 1; j <= n; j++) {
                // if current character of X and Y matches
                if (X[i - 1] == Y[j - 1])
                    lookup[i][j] = lookup[i - 1][j - 1] + 1;

                // else if current character of X and Y don't match
                else
                    lookup[i][j] = Math.max(lookup[i - 1][j], lookup[i][j - 1]);
            }
        }

        // LCS will be last entry in the lookup table
        return lookup[m][n];
    }
}

class DarkMode {
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

class ViewMode {
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

class Template {
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

function init(isFirstRun) {
    view.darkMode = new DarkMode();

    view.dlcs = [];
    view.dlcsMap = new Map();
    for (let dlc of (params.dlcs || [])) {
        d = new DLC(dlc);
        view.dlcs.push(d);
        view.dlcsMap.set(d.id, d);
        if (localStorage) {
            let id = "settings." + d.id;
            if (localStorage.getItem(id) != null)
                d.checked(parseInt(localStorage.getItem(id)));

            d.checked.subscribe(val => localStorage.setItem(id, val ? 1 : 0));
        }
    }

    // set up options
    view.settings.options = [];
    for (let attr in options) {
        let o = new Option(options[attr]);
        o.id = attr;
        view.settings[attr] = o;
        view.settings.options.push(o);

        if (localStorage) {
            let id = "settings." + attr;
            if (localStorage.getItem(id) != null)
                o.checked(parseInt(localStorage.getItem(id)));

            o.checked.subscribe(val => localStorage.setItem(id, val ? 1 : 0));
        }
    }

    view.settings.languages = params.languages;

    view.settings.serverOptions = [];
    for (let attr in serverOptions) {
        let o = new Option(serverOptions[attr]);
        o.id = attr;
        if (attr != "optimalProductivity")
            o.checked(true);
        view.settings[attr] = o;
        view.settings.serverOptions.push(o);

        if (localStorage) {
            let id = "serverSettings." + attr;
            if (localStorage.getItem(id) != null)
                o.checked(parseInt(localStorage.getItem(id)));

            o.checked.subscribe(val => localStorage.setItem(id, val ? 1 : 0));
        }
    }

    view.settings.populationInput = ko.observable("1");
    if (localStorage) {
        let id = "settings.populationInput";
        let oldId = "settings.existingBuildingsInput";
        if (localStorage.getItem(id) != null)
            view.settings.populationInput(localStorage.getItem(id));

        view.settings.populationInput.subscribe(val => {
            if (val != "0" && val != "1" && val != "2")
                view.settings.populationInput("1");

            localStorage.setItem(id, val);
        });

        if (localStorage.getItem(oldId) != null) {
            view.settings.populationInput("0");
            localStorage.removeItem(oldId);
        }
    }

    view.assetsMap = new Map();

    view.regions = [];
    for (let region of (params.regions || [])) {
        let r = new Region(region);
        view.assetsMap.set(r.guid, r);
        view.regions.push(r);
    }

    view.sessions = [];
    for (let session of (params.sessions || [])) {
        let s = new Session(session, view.assetsMap);
        view.assetsMap.set(s.guid, s);
        view.sessions.push(s);
    }

    // set up newspaper
    view.newspaperConsumption = new NewspaperNeedConsumption();
    if (localStorage) {
        let id = "newspaperPropagandaBuff";
        if (localStorage.getItem(id) != null)
            view.newspaperConsumption.selectedBuff(localStorage.getItem(id));

        view.newspaperConsumption.selectedBuff.subscribe(val => localStorage.setItem(id, val));
    }

    for (var e of (params.newspaper || [])) {
        var effect = new NewspaperNeedConsumptionEntry(e);
        view.newspaperConsumption.add(effect);

        if (localStorage) {
            let id = effect.guid + ".checked";
            if (localStorage.getItem(id) != null)
                effect.checked(parseInt(localStorage.getItem(id)));

            effect.checked.subscribe(val => localStorage.setItem(id, val ? 1 : 0));
        }
    }

    // set up NPC traders
    view.productsToTraders = new Map();
    for (var t of (params.traders || [])) {
        var trader = new NPCTrader(t);

        for (var r of t.goodsProduction) {
            var route = $.extend({}, r, { trader: trader });
            if (view.productsToTraders.has(r.Good))
                view.productsToTraders.get(r.Good).push(route);
            else
                view.productsToTraders.set(r.Good, [route]);
        }
    }

    if (params.tradeContracts) {
        view.contractUpgradeManager = new ContractUpgradeManager();
    }

    // set up island management
    view.islandManager = new IslandManager(params, isFirstRun);

    if (localStorage) {
        let id = "language";
        if (localStorage.getItem(id))
            view.settings.language(localStorage.getItem(id));

        view.settings.language.subscribe(val => localStorage.setItem(id, val));
    }

    if (!isFirstRun)
        configUpgrade();
    else
        localStorage.setItem("upgrade.bonusResidentsApplied", 1);


    // set up modal dialogs
    view.skyscraperDropdownStatus = ko.observable("hide");
    view.selectedFactory = ko.observable(view.island().factories[0]);
    view.selectedPopulationLevel = ko.observable(view.island().populationLevels[0]);
    view.selectedGoodConsumptionUpgradeList =
        ko.observable(view.island().populationLevels[0].needs[0].goodConsumptionUpgradeList);
    view.productionChain = new ProductionChainView();
    view.selectedGoodConsumptionUpgradeIslandList = ko.observable(view.island().allGoodConsumptionUpgrades);
    view.selectedMultiFactoryProducts = ko.observable(view.island().multiFactoryProducts);
    view.selectedReplaceInputItems = ko.observable(view.island().replaceInputItems);
    view.selectedExtraGoodItems = ko.observable(view.island().extraGoodItems);
    view.selectedContractManager = ko.observable(view.island().contractManager);

    $('#good-consumption-island-upgrade-dialog').on('show.bs.modal',
        () => {
            view.selectedGoodConsumptionUpgradeIslandList(view.island().allGoodConsumptionUpgrades);
        });

    $('#factory-choose-dialog').on('show.bs.modal',
        () => {
            view.selectedMultiFactoryProducts(view.island().multiFactoryProducts
                .filter(p => p.availableFactories().length > 1)
                .sort((a, b) => a.name().localeCompare(b.name())));
            view.selectedReplaceInputItems(view.island().replaceInputItems);
        });

    $('#item-equipment-dialog').on('show.bs.modal',
        () => {
            view.selectedExtraGoodItems(view.island().extraGoodItems);
        });

    $('#contract-management-dialog').on('show.bs.modal',
        () => {
            view.selectedContractManager(view.island().contractManager);
        });

    // store collapsable state of skyline configuration closing and reopening would otherwise restore the default
    view.selectedPopulationLevel.subscribe(() => {
        setTimeout(() => {
            $('#population-level-building-configuration').collapse(view.skyscraperDropdownStatus());
            $('#population-level-building-configuration').off();
            $('#population-level-building-configuration').on("hidden.bs.collapse shown.bs.collapse", function (event) {
                if ($(this).hasClass("show")) {
                    view.skyscraperDropdownStatus("show");
                } else {
                    view.skyscraperDropdownStatus("hide");
                }
            });
        }, 200);
    })

    view.tradeManager = new TradeManager();

    if (params.tradeContracts) {
        view.contractCreatorFactory = new ContractCreatorFactory();
    }

    var allIslands = view.islandManager.allIslands;
    var selectedIsland = view.island();
    var templates = [];
    var arrayToTemplate = (name) => allIslands[name].map((asset, index) => {
        var t = new Template(asset, selectedIsland, name, index);
        templates.push(t);
        return t;
    });

    view.island.subscribe(i => templates.forEach(t => t.parentInstance(i)));

    view.template = {
        populationLevels: arrayToTemplate("populationLevels"),
        categories: arrayToTemplate("categories"),
        consumers: arrayToTemplate("consumers"),
        powerPlants: arrayToTemplate("powerPlants"),
        publicRecipeBuildings: arrayToTemplate("publicRecipeBuildings"),
        buildingMaterialsNeeds: arrayToTemplate("buildingMaterialsNeeds")
    }

    view.viewMode = new ViewMode(isFirstRun);

    ko.applyBindings(view, $(document.body)[0]);

    if (view.viewMode.showOnStartup)
        $('#view-mode-dialog').modal("show");

    view.island().name.subscribe(val => { window.document.title = val; });

    // set up key bindings
    var keyBindings = ko.computed(() => {
        var bindings = new Map();

        var language = view.settings.language();
        if (language == 'chinese' || language == 'korean' || language == 'japanese' || language == 'taiwanese') {
            language = 'english';
        }

        for (var l of view.island().populationLevels) {
            var name = l.locaText[language];

            for (var c of name.toLowerCase()) {
                if (!bindings.has(c)) {
                    bindings.set(c, $(`.ui-tier-unit-name[tier-unit-guid=${l.guid}] ~ .input .input-group input`));
                    l.hotkey(c);
                    break;
                }
            }
        }

        return bindings;
    });

    $(document).on("keydown", (evt) => {
        if (evt.altKey || evt.ctrlKey || evt.shiftKey)
            return true;

        if (evt.target.tagName === 'TEXTAREA')
            return true;

        if (evt.target.tagName === 'INPUT' && evt.target.type === "text")
            return true;

        var focused = false;
        var bindings = keyBindings();
        if (bindings.has(evt.key)) {
            focused = true;
            bindings.get(evt.key).focus().select();
        }

        if (evt.target.tagName === 'INPUT' && !isNaN(parseInt(evt.key)) || focused) {
            let isDigit = evt.key >= "0" && evt.key <= "9";
            return ['ArrowUp', 'ArrowDown', 'Backspace', 'Delete'].includes(evt.key) || isDigit || evt.key === "." || evt.key === ",";
        }
    });


    // listen for the server providing the population count
    window.reader = new PopulationReader();
}

function removeSpaces(string) {
    if (typeof string === "function")
        string = string();
    return string.replace(/\W/g, "");
}

var formater = new Intl.NumberFormat(navigator.language || "en").format;
function formatNumber(num) {
    var rounded = Math.ceil(100 * parseFloat(num)) / 100;
    if (Math.abs(rounded) < EPSILON)
        rounded = 0;
    return formater(rounded);
}

class NumberInputHandler {
    constructor(params) {
        this.obs = params.obs;
        this.id = params.id;
        this.max = parseFloat($('#' + this.id).attr('max') || Infinity);
        this.min = parseFloat($('#' + this.id).attr('min') || -Infinity);
        this.step = parseFloat($('#' + this.id).attr('step') || 1);
        this.input = $('#' + this.id);
        if (this.input.length != 1)
            console.log("Invalid binding", this.id, this.input);
        this.input.on("wheel", evt => {
            if (document.activeElement !== this.input.get(0))
                return;

            evt.preventDefault();
            var deltaY = evt.deltaY || (evt.originalEvent || {}).deltaY;
            var sign = -Math.sign(deltaY);
            var factor = this.getInputFactor(evt);

            var val = parseFloat(this.obs()) + sign * factor * this.step + ACCURACY;
            val = Math.max(this.min, Math.min(this.max, val));
            this.obs(Math.floor(val / this.step) * this.step);

            return false;
        });
    }

    getInputFactor(evt) {
        var factor = 1
        if (evt.ctrlKey)
            factor *= 10
        if (evt.shiftKey)
            factor *= 100
        return factor
    }
}


ko.components.register('number-input-increment', {
    viewModel: {
        // - 'params' is an object whose key/value pairs are the parameters
        //   passed from the component binding or custom element
        // - 'componentInfo.element' is the element the component is being
        //   injected into. When createViewModel is called, the template has
        //   already been injected into this element, but isn't yet bound.
        // - 'componentInfo.templateNodes' is an array containing any DOM
        //   nodes that have been supplied to the component. See below.
        createViewModel: (params, componentInfo) => new NumberInputHandler(params)
    },
    template:
        `<div class="input-group-btn-vertical" >
                                                        <button class="btn btn-default" type="button" data-bind="click: (_, evt) => {var factor = getInputFactor(evt); var val = parseFloat(obs()) + factor * step + ACCURACY; obs(Math.floor(val/step)*step)}, enable: obs() < max"><i class="fa fa-caret-up"></i></button>
                                                        <button class="btn btn-default" type="button" data-bind="click: (_, evt) => {var factor = getInputFactor(evt); var val = parseFloat(obs()) - factor * step - ACCURACY; obs(Math.ceil(val/step)*step)}, enable: obs() > min"><i class="fa fa-caret-down"></i></button>
                                                    </div>`
});

ko.components.register('notes-section', {
    template:
        `<div class="form-group notes-section" data-bind="if: $data.notes != null">
              <textarea class="form-control" data-bind="textInput: $data.notes, attr: {placeholder: $root.texts.notes.name()}"></textarea>
        </div>`
});

ko.components.register('lock-toggle', {
    template:
        `<div style="cursor: pointer" data-bind="click: () => {checked(!checked());}">
             <img class="icon-sm icon-light" src="icon_unlock.png" data-bind="style: {display : checked()? 'none' : 'inherit'}">
             <img class="icon-sm icon-light" src="icon_lock.png" style="display: none;"  data-bind="style: {display : checked()? 'inherit' : 'none'}">
        </div>`
});

function formatPercentage(number) {
    var str = window.formatNumber(Math.ceil(10 * parseFloat(number)) / 10) + ' %';
    if (number > 0)
        str = '+' + str;

    return str;
}

function delayUpdate(obs, val) {
    var version = obs.getVersion ? obs.getVersion() : obs();
    setTimeout(() => {
        if (obs.getVersion && !obs.hasChanged(version) || version === obs())
            obs(val);
    });
}

// from https://knockoutjs.com/documentation/extenders.html
ko.extenders.numeric = function (target, bounds) {
    //create a writable computed observable to intercept writes to our observable
    var result = ko.computed({
        read: target,  //always return the original observables value
        write: function (newValue) {
            var current = target();

            if (bounds.precision === 0)
                var valueToWrite = parseInt(newValue);
            else if (bounds.precision) {
                var roundingMultiplier = Math.pow(10, bounds.precision);
                var newValueAsNum = isNaN(newValue) ? 0 : +newValue;
                var valueToWrite = Math.round(newValueAsNum * roundingMultiplier) / roundingMultiplier;
            } else {
                var valueToWrite = parseFloat(newValue);
            }

            if (!isFinite(valueToWrite) || valueToWrite == null) {
                if (newValue != current)
                    target.notifySubscribers(); // reset input field

                return;
            }

            if (valueToWrite > bounds.max)
                valueToWrite = bounds.max;

            if (valueToWrite < bounds.min)
                valueToWrite = bounds.min;

            if (bounds.callback && typeof bounds.callback === "function") {
                valueToWrite = bounds.callback(valueToWrite, current, newValue);
                if (valueToWrite == null)
                    return;
            }

            //only write if it changed
            if (valueToWrite !== current) {
                if (result._state && result._state.isBeingEvaluated) {
                    console.log("cycle detected, propagation stops");
                    return;
                }

                target(valueToWrite);
            }
        }
    }).extend({ notify: 'always' });

    //initialize with current value to make sure it is rounded appropriately
    result(target());

    //return the new computed observable
    return result;
};


/**
 * 
 * @param {number} init - inital value
 * @param {number} min
 * @param {number} max
 * @param {beforeValueUpdateCallback} callback
 */
function createIntInput(init, min = -Infinity, max = Infinity, callback = null) {
    return ko.observable(init).extend({
        numeric: {
            precision: 0,
            min: min,
            max: max,
            callback: callback
        }
    });
}

function createFloatInput(init, min = -Infinity, max = Infinity, callback = null) {
    return ko.observable(init).extend({
        numeric: {
            min: min,
            max: max,
            precision: 6,
            callback: callback
        }
    });
}

function factoryReset() {
    if (localStorage)
        localStorage.clear();

    location.reload();
}

function setDefaultFixedFactories(assetsMap) {
    // Default rum, cotton fabric and coffee to the new world production
    assetsMap.get(1010240).fixedFactory(assetsMap.get(1010318));
    assetsMap.get(1010257).fixedFactory(assetsMap.get(1010340));
    assetsMap.get(120032).fixedFactory(assetsMap.get(101252));
    assetsMap.get(1010216).fixedFactory(assetsMap.get(1010294));
    assetsMap.get(1010214).fixedFactory(assetsMap.get(1010292));
}

function isLocal() {
    return window.location.protocol == 'file:' || /localhost|127\.0\.0\.1/.test(window.location.host.replace);
}

function exportConfig() {
    var saveData = (function () {
        var a = document.createElement("a");
        document.body.appendChild(a);
        a.style = "display: none";
        return function (data, fileName) {
            var blob = new Blob([JSON.stringify(data, null, 4)], { type: "text/json" }),
                url = window.URL.createObjectURL(blob);
            a.href = url;
            a.download = fileName;
            a.click();
            window.URL.revokeObjectURL(url);
        };
    }());

    saveData(localStorage, ("Anno1800CalculatorConfig") + ".json");
}

function batchImports(source, destinations, factories) {
    if (!(source instanceof Island))
        source = view.islandManager.getByName(source);

    for (var dest of destinations) {
        if (!(dest instanceof Island))
            dest = view.islandManager.getByName(dest);

        for (var f of factories) {
            var list = dest.assetsMap.get(f).tradeList;

            if (list.factory.overProduction() > -ACCURACY)
                continue;

            list.onShow();
            if (list.unusedIslands.indexOf(source) == -1)
                continue;

            list.selectedIsland(source);
            list.export(false);
            list.newAmount(Math.abs(list.factory.overProduction()));
            list.create();
        }
    }
}

function batchExports(sources, destination, factories) {
    if (!(destination instanceof Island))
        destination = view.islandManager.getByName(destination);

    for (var src of sources) {
        if (!(src instanceof Island))
            src = view.islandManager.getByName(src);

        for (var f of factories) {
            var list = src.assetsMap.get(f).tradeList;

            if (list.factory.overProduction() < ACCURACY)
                continue;

            list.onShow();
            if (list.unusedIslands.indexOf(destination) == -1)
                continue;

            list.selectedIsland(destination);
            list.export(true);
            list.newAmount(Math.abs(list.factory.overProduction()));
            list.create();
        }
    }
}

function checkAndShowNotifications() {
    $.getJSON("https://api.github.com/repos/NiHoel/Anno1800Calculator/releases/latest").done((release) => {
        $('#download-calculator-button').attr("href", release.zipball_url);

        if (isLocal()) {
            if (release.tag_name !== versionCalculator) {
                $.notify({
                    // options
                    message: view.texts.calculatorUpdate.name()
                }, {
                    // settings
                    type: 'warning',
                    placement: { align: 'center' }
                });
            }
        }

        if (localStorage) {
            if (localStorage.getItem("versionCalculator") != versionCalculator) {
                if (view.texts.newFeature.name() && view.texts.newFeature.name().length)
                    $.notify({
                        // options
                        message: view.texts.newFeature.name()
                    }, {
                        // settings
                        type: 'success',
                        placement: { align: 'center' },
                        timer: 60000
                    });
            }

            localStorage.setItem("versionCalculator", versionCalculator);
        }

    });
}

function installImportConfigListener() {
    if (localStorage) {
        $('#config-selector').on('change', event => {
            event.preventDefault();
            if (!event.target.files || !event.target.files[0])
                return;

            let file = event.target.files[0];
            console.log(file);
            var fileReader = new FileReader();

            fileReader.onload = function (ev) {
                let text = ev.target.result || ev.currentTarget.result;

                try {
                    let config = JSON.parse(text);

                    if (localStorage) {

                        if (config.islandName && config.islandName != "Anno 1800 Calculator" &&
                            !config.islandNames && !config[config.islandName] && (!config.versionCalculator || config.versionCalculator.startsWith("v1") || config.versionCalculator.startsWith("v2"))) {
                            // import old, one island save
                            delete config.versionCalculator;
                            delete config.versionServer;

                            view.islandManager.islandNameInput(config.islandName);
                            view.islandManager.create();
                            var island = view.islands().filter(i => i.name() == config.islandName)[0];
                            island.storage.json = config;
                            island.storage.save();
                            localStorage.setItem("islandName", config.islandName);
                        } else {
                            localStorage.clear();
                            for (var a in config)
                                localStorage.setItem(a, config[a]);
                            localStorage.setItem("versionCalculator", versionCalculator);

                            if (!config.islandNames) { // old save, restore islands
                                for (var island of view.islands()) {
                                    if (!island.isAllIslands())
                                        island.storage.save();
                                }
                                let islandNames = JSON.stringify(view.islands().filter(i => !i.isAllIslands()).map(i => i.name()));
                                localStorage.setItem("islandNames", islandNames);
                            }
                        }
                        location.reload();

                    } else {
                        console.error("No local storage accessible to write result into.");
                    }

                } catch (e) {
                    console.error(e);
                }
            };
            fileReader.onerror = function (err) {
                console.error(err);
            };

            fileReader.readAsText(file);
        });
    }
}

$(document).ready(function () {
    var isFirstRun = !localStorage || localStorage.getItem("versionCalculator") == null;

    // parse the parameters
    for (let attr in texts) {
        view.texts[attr] = new NamedElement({ name: attr, locaText: texts[attr] });
    }

    // check version of calculator - display update and new featur notification
    checkAndShowNotifications();

    //update links of download buttons
    $.getJSON("https://api.github.com/repos/NiHoel/Anno1800UXEnhancer/releases/latest").done((release) => {
        $('#download-calculator-server-button').attr("href", release.assets[0].browser_download_url);
    });

    installImportConfigListener();


    //load parameters
    if (window.params == null)
        $('#params-dialog').modal("show");
    else
        init(isFirstRun);

    $('#params-dialog').on('hide.bs.modal', () => {
        try {
            window.params = JSON.parse($('textarea#input-params').val());
            init(isFirstRun);
        } catch (e) {
            console.log(e);
            $('#params-dialog').modal("show");
        }
    });

    $('[data-toggle="popover"]').popover();
})
