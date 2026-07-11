"""Generate an open-source validation pack for the fictional CV-104 study.

This adapter deliberately separates calculation-engine output from source-screen
evidence. ArcFlash Copilot is a computer-use/reporting layer: it never silently
replaces an extracted value with a recalculation.

Engines:
  * pandapower: IEC 60909 three-phase short-circuit calculation
  * LiaungYip/arcflash: IEEE 1584-2018 arcing-current and incident-energy adapter

The MCC-01 clearing time is intentionally None. Its arc-flash energy is therefore
not calculated here; the source-screen value remains marked for engineer review.
"""

from __future__ import annotations

import argparse
import json
import warnings
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

import pandapower as pp
import pandapower.shortcircuit as sc
from arcflash.ieee_1584.calculation import Calculation
from arcflash.ieee_1584.cubicle import Cubicle
from arcflash.ieee_1584.units import cal_per_sq_cm, inch, kA, kV, mm, ms

warnings.filterwarnings("ignore", category=FutureWarning, module=r"pandapower\..*")


@dataclass(frozen=True)
class SourceEvidence:
    equipment_id: str
    source_incident_energy_cal_cm2: float
    source_boundary_in: float
    protective_device_clearing_time_s: float | None


SOURCE_EVIDENCE = (
    SourceEvidence("SWGR-01", 6.3, 55.0, 0.087),
    SourceEvidence("MCC-01", 3.6, 38.0, None),
    SourceEvidence("CV-104", 1.2, 18.0, 0.050),
)


def build_network() -> tuple[pp.pandapowerNet, dict[str, int]]:
    """Create the simplified utility → transformer → MCC → conveyor model."""
    net = pp.create_empty_network(name="CV-104 Conveyor Electrical Distribution", f_hz=60.0, sn_mva=100.0)

    buses = {
        "U-01": pp.create_bus(net, vn_kv=13.8, name="Utility Source U-01"),
        "SWGR-01": pp.create_bus(net, vn_kv=0.48, name="Main Switchgear SWGR-01"),
        "MCC-01": pp.create_bus(net, vn_kv=0.48, name="Motor-Control Centre MCC-01"),
        "CV-104": pp.create_bus(net, vn_kv=0.48, name="Conveyor Motor CV-104"),
    }

    pp.create_ext_grid(
        net,
        bus=buses["U-01"],
        vm_pu=1.0,
        s_sc_max_mva=500.0,
        s_sc_min_mva=350.0,
        rx_max=0.10,
        rx_min=0.10,
        name="13.8 kV Utility",
    )
    pp.create_transformer_from_parameters(
        net,
        hv_bus=buses["U-01"],
        lv_bus=buses["SWGR-01"],
        sn_mva=1.5,
        vn_hv_kv=13.8,
        vn_lv_kv=0.48,
        vk_percent=5.75,
        vkr_percent=1.0,
        pfe_kw=2.2,
        i0_percent=0.35,
        vector_group="Dyn11",
        name="Transformer T-01",
    )
    pp.create_line_from_parameters(
        net,
        from_bus=buses["SWGR-01"],
        to_bus=buses["MCC-01"],
        length_km=0.055,
        r_ohm_per_km=0.125,
        x_ohm_per_km=0.080,
        c_nf_per_km=0.0,
        max_i_ka=1.6,
        endtemp_degree=90.0,
        name="FDR-12 Switchgear to MCC",
    )
    pp.create_line_from_parameters(
        net,
        from_bus=buses["MCC-01"],
        to_bus=buses["CV-104"],
        length_km=0.115,
        r_ohm_per_km=0.206,
        x_ohm_per_km=0.083,
        c_nf_per_km=0.0,
        max_i_ka=0.55,
        endtemp_degree=90.0,
        name="CV-104 Motor Feeder",
    )
    pp.create_load(net, bus=buses["CV-104"], p_mw=0.165, q_mvar=0.075, name="250 hp Conveyor Motor Load")
    return net, buses


def calculate_ieee_1584(bolted_fault_ka: float, clearing_time_s: float | None) -> dict[str, float | None]:
    """Calculate arcing current, energy, and AFB for a typical 480 V VCB enclosure."""
    cubicle = Cubicle(
        V_oc=0.48 * kV,
        EC="VCB",
        G=32 * mm,
        D=18 * inch,
        height=610 * mm,
        width=610 * mm,
        depth=254 * mm,
    )
    calculation = Calculation(cubicle, bolted_fault_ka * kA, "full")
    calculation.calculate_I_arc()

    result: dict[str, float | None] = {
        "arcing_current_ka": round(float(calculation.I_arc.m_as(kA)), 4),
        "incident_energy_cal_cm2": None,
        "arc_flash_boundary_in": None,
    }
    if clearing_time_s is not None:
        calculation.calculate_E_AFB(clearing_time_s * 1000 * ms)
        result["incident_energy_cal_cm2"] = round(float(calculation.E.m_as(cal_per_sq_cm)), 4)
        result["arc_flash_boundary_in"] = round(float(calculation.AFB.m_as(inch)), 2)
    return result


def generate() -> dict[str, object]:
    net, buses = build_network()
    sc.calc_sc(net, fault="3ph", case="max", ip=True, ith=True, branch_results=False)

    results = []
    for evidence in SOURCE_EVIDENCE:
        fault_current = float(net.res_bus_sc.at[buses[evidence.equipment_id], "ikss_ka"])
        validation = calculate_ieee_1584(fault_current, evidence.protective_device_clearing_time_s)
        results.append(
            {
                **asdict(evidence),
                "pandapower_bolted_fault_ka": round(fault_current, 4),
                "arcflash_validation": validation,
                "verification_status": (
                    "engineer_review_required"
                    if evidence.protective_device_clearing_time_s is None
                    else "calculation_available_for_comparison"
                ),
            }
        )

    return {
        "schema_version": "1.0",
        "generated_at": datetime.now(UTC).isoformat(),
        "project": "CV-104 Conveyor Electrical Distribution",
        "study_case": "Case A — Normal Utility / Main-Tie Open",
        "engines": {
            "short_circuit": "pandapower / IEC 60909",
            "arc_flash": "LiaungYip/arcflash / IEEE 1584-2018",
        },
        "disclaimer": (
            "Validation output only. Source-screen evidence remains authoritative for the demo, "
            "and all results require review by a qualified electrical engineer."
        ),
        "results": results,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("engine/output/cv104_validation.json"))
    args = parser.parse_args()
    payload = generate()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {args.output} with {len(payload['results'])} equipment validation records.")


if __name__ == "__main__":
    main()
