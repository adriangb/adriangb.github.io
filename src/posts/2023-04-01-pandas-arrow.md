---
draft: false
date: 2023-04-01
categories:
  - pandas
  - arrow
  - data engineering
---

# Data conversions in Pandas: Arrow to the rescue

An issue I've seen frequently in data engineering is is loss of type information when moving data between systems. This is especially bad when Pandas is in the mix, and it's one of the most widely used data engineering tools.

<!-- more -->

## Loss of type information within Pandas

Pandas' type system is generally quite broken. For a long time you [could not have an int column with null values](https://stackoverflow.com/a/54194908/6582418):

```python
>>> import pandas as pd

>>> # source data uses -1 to indicate missing, a pretty common scenario
>>> df = pd.DataFrame({"x": [-1, 2, 3]})
>>> # lets convert those to nones / nulls
>>> df['x'] = df['x'].map(lambda x: x if x != -1 else None)
>>> df
>>> df
     x
0  NaN
1  2.0
2  3.0
```

What happened here? Our integer column is now floats! There are dozens of similar things that you'll run into when _using_ Pandas. The good news is that this is pretty much a solved problem since [Pandas now supports Arrow data types](https://datapythonista.me/blog/pandas-20-and-the-arrow-revolution-part-i)! You could also use [Polars], but being able to switch Pandas' backend with just 1-2 LOC is very useful for existing codebases. And I expect this support to get better over time. If you haven't tried it yet, I highly recommend exploring this for at least pieces of your workflows.

[Polars]: https://www.pola.rs/

## Loss of type information at the edges

A lot of data workflows start with loading data and end with exporting that data. Often this will be loading or exporting to CSV and Parquet.

Using Arrow as the in-memory format also alleviates a lot of issues with loading and exporting Parquet: while Parquet != Arrow, Arrow is the de-factor in memory storage format for Parquet data, so Parquet interop is excellent.

Unfortunately that is not the case for CSVs: the format is fundamentally under-specified, inefficient and type unsafe. My suggestion: avoid it if you can, use Parquet or something else instead. The next post will discuss replacing CSVs with Parquet for the purposes of loading data into Postgres.

Of course if you already have a good domain model described via Protocol Buffers or something like that, you could use that as well.

### Empty files

Empty files are a particularly good example of CSV breaking down as a format. Since CSVs are not self describing (they're literally just a big string) when you load a CSV (into Pandas or anything else really) the types of the columns have to be inferred. But it's not just the types: it's line endings, delimiters, delimiter escaping and even null values. And there's no real way to fix these issues. I've seen entire processing steps dedicated to re-encoding a CSV file to adjust null values to a downstream systems' preferred null encoding. All of this is especially problematic for empty or small files because _there is nothing to infer these things from_.

What type are the columns if you load an empty CSV file (with headers) into Pandas? This will cause things to break in unexpected ways, e.g. if you're manipulating the DataFrame and call a `.dt` method it, it will break:

```python
from datetime import datetime
import pandas as pd

# fine, even with no rows
pd.DataFrame({'x': [(datetime.now())]})['x'][0:0].dt.hour
# AttributeError: Can only use .dt accessor with datetimelike values.
pd.DataFrame({'x': [str(datetime.now())]})['x'][0:0].dt.hour
```

You'll also encounter issues exporting data, e.g. if you export to a Parquet file that Parquet file will not have the wrong types.

And trying to apply types to an existing Pandas DataFrame is tricky. That is partially Pandas' APIs fault, but still the easiest way to avoid these issues it to never end up with a DataFrame of unknown types in the first place.

## Conclusion

I recommend you use Pandas' built in Apache Arrow storage backend or switch to an Arrow native library like Polars. Store your data as Parquet, not CSVs.
