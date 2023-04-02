---
draft: false
date: 2023-04-02
categories:
  - postgres
  - data engineering
---

# Loading data into Postgres

My last job was at American Family where I was team lead for a property data team. Our data had a wide range of consumers, some of them were data analysts who accessed data via BigQuery while others were ML engineers who trained models off of parquet files in GCS. But most of our users were actually realtime applications serving live humans. As you may know, humans sitting at a keyboard have a pretty short attention span, so low latency was a key requirement for this use case. They also looked up a single address at a time, which would have been expensive and high latency to do via BigQuery or GCS. So we loaded the data into Postgres and served it out from there. So what's the best way to bulk load data into Postgres?

<!-- more -->

But getting data into Postgres from a data warehouse is a non trivial affair. We were cross-cloud so I got to experience the process in both AWS and GCP, here's an overview of what that looks like.

In AWS, using Redshift and RDS Postgres, we would use Redshift's built in support to unload a prefix of CSV files. Then we would use RDS' built in S3 extension to load the data from S3 directly into Postgres via a SQL query. Internally this uses Postgres' built in CSV loading, it just manages the S3 auth and streaming.

In GCP we used BigQuery and CloudSQL Postgres. Although BigQuery does support exporting CSV files to GCS, GCP's CloudSQL offering doesn't have a built in GCS extension so you're left to spin up some sort of compute and run a small program to stream data from GCS into Postgres.

Both of these options use Postgres' built in [CSV COPY](https://www.postgresql.org/docs/current/sql-copy.html) functionality.

While both of these solution work, they're really not great. As soon as you store your data in CSV files you loose all type information and metadata. Not to mention that Postgres may not agree with how the tool you use to export the data does delimiters, quotations, null fields, etc. Of course there's knobs on both export and import to tweak these things, but in my experience that's a huge time sink and sometimes unsolvable. Some more thoughts on CSV as a data interchange format in [my last post](./2023-04-01-pandas-arrow.md)

So what other options do we have for loading data into Postgres?

## Loading via a database driver

One option would be to load the data into Postgres using a database driver in your language of choice. This solves some of the issues because you no longer have to deal with delimiters, quoting things, null values and whatnot. Database drivers also tend to do a good job of converting native language data types (e.g. `datetime` objects in Python) into Postgres' data format, so type issues are less of a problem.

The con of this approach is performance. It's going to be [much slower than a bulk load](https://www.postgresql.org/docs/current/populate.html). Possibly even slower if your database driver isn't optimized for these sorts of workflows and encodes the data row by row, making FFI calls to `libqp` for each item and such.

Still, this can be an easy win, especially if you already are running your own compute and database driver like you would have to do for CloudSQL. At the very least you get more control over setting the right types and such on the CSV files, or if the data never had to be in CSV files in the first place and the only reason you made it CSVs was to load it into Postgres then you can sidestep the CSV step altogether.

## Loading another file format

Since the issue is fundamentally that CSVs are under specified and untyped, the obvious solution is to load data via another data format. And the obvious data format is Parquet. So, how can you bulk load a Parquet file into Postgres?

### Foreign data wrappers

There's at several option for Parquet FDWs:

- [parquet_fdw](https://github.com/adjust/parquet_fdw)
- [parquet_s3_fdw](https://github.com/pgspider/parquet_s3_fdw)
- Probably more

There is unfortunately several downsides to this approach:

- Installing Postgres extensions is not simple.
- Your Postgres database may not let you install extensions. This is pretty much the norm with hosted Postgres solutions, less of an issue with providers like [CrunchyData].
- Giving the FDW running inside of your Postgres instance access to your data can be difficult, e.g. if it's stored on a private bucket. How does the FDW do auth against your bucket provider?
- This requires you to have written the data out, there's no streaming support.
- No escape hatch. If the FDW doesn't support the type of column you're working with or you otherwise need to customize things there's no escape hatch, you might be on your own. This is especially dangerous since it might not show up until late into development once the requirements become more complex.

[CrunchyData]: https://www.crunchydata.com/

## COPY WITH FORMAT BINARY

Did you know that Postgres actually has a standardized binary format you can use to bulk load binary data? It even supports _streaming_ data copies. So what we need is a way to encode data into Postgres' binary format.

Since we already wanted to [use Parquet as our data storage format and Apache Arrow as our in-memory format](./2023-04-01-pandas-arrow.md) the natural thing to do was to encode Arrow data into Postgres' binary format. After some initial prototyping in Python, I ended up writing [pgpq], a Rust library that leverages the excellent [arrow-rs] crate to encode Arrow data into Postgres' binary format.

The end result turned out better than I expected:

- It's streaming friendly, you can encode anything from a single row to 100k rows at a time.
- The design is purposefully sans-IO so it works with any database driver, any Postgres host and any data source (it doesn't need to auth against Postgres or the data source).
- There's excellent interop with Arrow, so you can use Arrow's existing ability to talk directly to object stores or stream larger than memory data.
- Support for types is vastly superior to that of any FDW that I know of. It can encode nearly all Arrow types, including list arrays and in the future struct arrays.
- Performance is _excellent_: I've benchmarked reading, encoding and loading a Parquet file to be _faster_ than loading an equivalent CSV file.
- Depending on your infra topology offloading CPU use from your database (which is hard to scale and expensive to run compute on) to arbitrary compute can save money and alleviate concerns about overloading your database.

Here's a quick usage example:

```python
from tempfile import mkdtemp
import psycopg
import pyarrow.dataset as ds
import requests
from pgpq import ArrowToPostgresBinaryEncoder

# let's get some example data
tmpdir = mkdtemp()
with open(f"{tmpdir}/yellow_tripdata_2023-01.parquet", mode="wb") as f:
    resp = requests.get(
        "https://d37ci6vzurychx.cloudfront.net/trip-data/yellow_tripdata_2023-01.parquet"
    )
    resp.raise_for_status()
    f.write(resp.content)

# load an arrow dataset
# arrow can load datasets from partitioned parquet files locally or in S3/GCS
# it handles buffering, matching globs, etc.
dataset = ds.dataset(tmpdir)

# create an encoder object which will do the encoding
# and give us the expected Postgres table schema
encoder = ArrowToPostgresBinaryEncoder(dataset.schema)
# get the expected Postgres destination schema
# note that this is _not_ the same as the incoming arrow schema
# and not necessarily the schema of your permanent table
# instead it's the schema of the data that will be sent over the wire
# which for example does not have timezones on any timestamps
pg_schema = encoder.schema()
# assemble ddl for a temporary table
# it's often a good idea to bulk load into a temp table to:
# (1) Avoid indexes
# (2) Stay in-memory as long as possible
# (3) Be more flexible with types
#     (you can't load a SMALLINT into a BIGINT column without casting)
cols = [f'"{col_name}" {col.data_type.ddl()}' for col_name, col in pg_schema.columns]
ddl = f"CREATE TEMP TABLE data ({','.join(cols)})"

with psycopg.connect("postgres://postgres:postgres@localhost:5432/postgres") as conn:
    with conn.cursor() as cursor:
        cursor.execute(ddl)  # type: ignore
        with cursor.copy("COPY data FROM STDIN WITH (FORMAT BINARY)") as copy:
            copy.write(encoder.write_header())
            for batch in dataset.to_batches():
                copy.write(encoder.write_batch(batch))
            copy.write(encoder.finish())
        # load into your actual table, possibly doing type casts
        # cursor.execute("INSERT INTO \"table\" SELECT * FROM data")
```

### Type support

Here is the current list of supported types:

|   Arrow                   |   Postgres       |
|---------------------------|------------------|
|   Boolean                 |   BOOL           |
|   UInt8                   |   INT2           |
|   UInt16                  |   INT4           |
|   UInt32                  |   INT8           |
|   Int8                    |   CHAR,INT2      |
|   Int16                   |   INT2           |
|   Int32                   |   INT4           |
|   Int64                   |   INT8           |
|   Float16                 |   FLOAT4         |
|   Float32                 |   FLOAT4         |
|   Float64                 |   FLOAT8         |
|   Timestamp(Nanosecond)   |   Not supported  |
|   Timestamp(Microsecond)  |   TIMESTAMP      |
|   Timestamp(Millisecond)  |   TIMESTAMP      |
|   Timestamp(Second)       |   TIMESTAMP      |
|   Date32                  |   DATE           |
|   Date64                  |   DATE           |
|   Time32(Millisecond)     |   TIME           |
|   Time32(Second)          |   TIME           |
|   Time64(Nanosecond)      |   Not supported  |
|   Time64(Microsecond)     |   TIME           |
|   Duration(Nanosecond)    |   Not supported  |
|   Duration(Microsecond)   |   INTERVAL       |
|   Duration(Millisecond)   |   INTERVAL       |
|   Duration(Second)        |   INTERVAL       |
|   String                  |   TEXT,JSONB     |
|   Binary                  |   BYTEA          |
|   List<T\>                |   Array<T\>      |

An up to date version of this can be found at the [pgpq] repo.

## Postgres needs better docs

The hardest part, by far, of writing this library was Postgres' seriously lacking documentation of their binary format. I had to piece it together by reading [Postgres COPY docs](https://www.postgresql.org/docs/current/sql-copy.html), the [rust-postgres](https://github.com/sfackler/rust-postgres) source code and the [py-pgproto](https://github.com/MagicStack/py-pgproto) source code. Postgres' docs and developers tell you to go read the Postgres source code. I just don't see why they can't have a documentation page where they detail the binary format, it really isn't that complicated, it's just poorly documented. Better documentation on the binary protocol would make it a lot easier to write tooling for the Postgres ecosystem.

[arrow-rs]: https://github.com/apache/arrow-rs
[pgpq]: https://github.com/adriangb/pgpq
