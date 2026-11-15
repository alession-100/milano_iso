import geopandas
import pyogrio
import pyproj
import shapely
from milano_iso import __version__
from milano_iso.cli import main


def test_package_version():
    assert __version__ == "0.1.0"


def test_cli_runs(capsys):
    assert main() == 0
    assert "not implemented yet" in capsys.readouterr().out


def test_geo_stack_imports():
    assert all(m.__name__ for m in (geopandas, pyogrio, pyproj, shapely))
