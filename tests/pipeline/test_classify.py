"""Tests for the OSM classification rules (synthetic tags only)."""

import pytest
from milano_iso import classify
from milano_iso.classify import AREA, LINE, POINT
from milano_iso.classify import classify as run


def layers(kind, tags):
    return run(kind, tags)


def test_building_area_and_building_no():
    assert layers(AREA, {"building": "apartments"}) == {"osm_buildings": "apartments"}
    assert layers(AREA, {"building": "no"}) == {}
    # building rules apply to areas only
    assert layers(POINT, {"building": "yes"}) == {}


def test_building_part_is_separate_from_building():
    assert layers(AREA, {"building:part": "yes"}) == {"osm_building_parts": "yes"}
    both = layers(AREA, {"building": "yes", "building:part": "yes"})
    assert set(both) == {"osm_buildings", "osm_building_parts"}


def test_road_line():
    assert layers(LINE, {"highway": "residential"}) == {"roads": "residential"}


def test_closed_roundabout_way_becomes_a_road_not_a_road_area():
    # osmium assembles a closed highway way as an area; without area=yes it is a road
    got = layers(AREA, {"highway": "primary", "junction": "roundabout"})
    assert got == {"roads": "primary"}


def test_pedestrian_area_yes_square_is_a_road_area_only():
    got = layers(AREA, {"highway": "pedestrian", "area": "yes"})
    assert got == {"road_areas": "pedestrian"}
    assert layers(AREA, {"area:highway": "traffic_island"}) == {"road_areas": "traffic_island"}


def test_rail_classes_only():
    assert layers(LINE, {"railway": "tram"}) == {"rail": "tram"}
    assert layers(LINE, {"railway": "subway"}) == {"rail": "subway"}
    assert layers(LINE, {"railway": "platform"}) == {}
    assert layers(LINE, {"railway": "razed"}) == {}


def test_water_kinds():
    assert layers(AREA, {"natural": "water"}) == {"water": "water"}
    assert layers(AREA, {"natural": "water", "water": "pond"}) == {"water": "pond"}
    assert layers(AREA, {"waterway": "riverbank"}) == {"water": "riverbank"}
    assert layers(AREA, {"water": "reflecting_pool"}) == {"water": "reflecting_pool"}
    assert layers(LINE, {"waterway": "canal"}) == {"water": "canal"}


def test_green_beats_landuse_and_other_landuse_is_landuse():
    assert layers(AREA, {"leisure": "park"}) == {"green": "park"}
    assert layers(AREA, {"landuse": "grass"}) == {"green": "grass"}
    assert layers(AREA, {"natural": "wood"}) == {"green": "wood"}
    assert layers(AREA, {"amenity": "grave_yard"}) == {"green": "grave_yard"}
    assert layers(AREA, {"landuse": "residential"}) == {"landuse": "residential"}
    both = layers(AREA, {"leisure": "garden", "landuse": "residential"})
    assert set(both) == {"green", "landuse"}


def test_named_features_for_every_geometry_kind():
    for kind in (POINT, LINE, AREA):
        assert "named_features" in layers(kind, {"name": "X"})
    got = layers(AREA, {"building": "yes", "name": "Duomo"})
    assert set(got) == {"osm_buildings", "named_features"}


def test_unassigned_objects():
    assert layers(POINT, {"natural": "tree"}) == {}
    assert layers(AREA, {"man_made": "artwork"}) == {}
    assert layers(POINT, {"addr:street": "Via X"}) == {}


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("primary", "primary"),
        ("primary_link", "primary"),
        ("residential", "residential"),
        ("traffic_island", "traffic_island"),
        ("bus_guideway", "other"),
        (None, "other"),
    ],
)
def test_highway_class(value, expected):
    assert classify.highway_class(value) == expected


@pytest.mark.parametrize(
    ("tags", "expected"),
    [
        ({"tunnel": "yes"}, True),
        ({"tunnel": "building_passage"}, False),
        ({"location": "underground"}, True),
        ({"layer": "-1"}, True),
        ({"layer": "-1;-2"}, True),
        ({"layer": "-1;0"}, False),
        ({"layer": "1"}, False),
        ({"layer": "weird"}, False),
        ({}, False),
    ],
)
def test_is_underground(tags, expected):
    assert classify.is_underground(tags) is expected


def test_top_tag_key_and_category():
    assert classify.top_tag_key({"name": "A", "amenity": "cafe", "building": "yes"}) == "building"
    assert classify.top_tag_key({"addr:street": "x", "foo": "1"}) == "foo"
    assert classify.top_tag_key({"addr:street": "x"}) == "(none)"
    assert classify.named_category({"amenity": "cafe", "name": "A"}) == "amenity=cafe"
    assert classify.named_category({"name": "A"}) == "other"


def test_rules_are_data_and_every_layer_has_a_rule():
    assert {r.layer for r in classify.RULES} == set(classify.LAYERS)
