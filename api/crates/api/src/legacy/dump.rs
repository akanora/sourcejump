//! Reads one table from a `mysqldump` file: its column names from `CREATE TABLE` and its rows from the
//! `INSERT INTO … VALUES (…),(…);` lines.
//!
//! Reading the dump file directly means the import needs no MySQL server. Only what `mysqldump` writes by default
//! is understood: one extended insert per line, values that are `NULL`, numbers or quoted strings with
//! backslash escapes. Anything else is an error, so a dump made another way fails instead of importing wrong.

use std::{collections::HashMap, fmt};

/// One value as the dump wrote it. Numbers stay text until the importer knows which type it wants.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Value {
    Null,
    Number(String),
    Text(String),
}

/// A table's rows, with its columns read by name so a dump with columns in another order still reads right.
#[derive(Debug)]
pub struct Table {
    columns: HashMap<String, usize>,
    pub rows: Vec<Vec<Value>>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct DumpError(String);

impl fmt::Display for DumpError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for DumpError {}

impl Table {
    /// Where a column sits in each row. The importer asks for every column before reading rows, so a missing
    /// one fails before anything is written.
    pub fn column(&self, name: &str) -> Result<usize, DumpError> {
        self.columns
            .get(name)
            .copied()
            .ok_or_else(|| DumpError(format!("the dump has no column `{name}`")))
    }
}

/// Reads `table` from the dump's text.
pub fn read_table(dump: &str, table: &str) -> Result<Table, DumpError> {
    let columns = read_columns(dump, table)?;
    let insert = format!("INSERT INTO `{table}` VALUES ");
    let mut rows = Vec::new();
    for (number, line) in dump.lines().enumerate() {
        if let Some(values) = line.strip_prefix(&insert) {
            read_rows(values, columns.len(), &mut rows)
                .map_err(|error| DumpError(format!("line {}: {error}", number + 1)))?;
        }
    }
    Ok(Table { columns, rows })
}

/// The column names between `CREATE TABLE` and its first key, in order.
fn read_columns(dump: &str, table: &str) -> Result<HashMap<String, usize>, DumpError> {
    let create = format!("CREATE TABLE `{table}` (");
    let mut lines = dump.lines().skip_while(|line| *line != create);
    if lines.next().is_none() {
        return Err(DumpError(format!("the dump has no table `{table}`")));
    }
    let names = lines
        .map(str::trim_start)
        .take_while(|line| line.starts_with('`'))
        .filter_map(|line| line[1..].split_once('`').map(|(name, _)| name.to_owned()));
    Ok(names
        .enumerate()
        .map(|(index, name)| (name, index))
        .collect())
}

/// Reads `(…),(…);` into rows of `width` values each.
fn read_rows(text: &str, width: usize, rows: &mut Vec<Vec<Value>>) -> Result<(), String> {
    let mut chars = text.chars().peekable();
    loop {
        if chars.next() != Some('(') {
            return Err("expected `(` to start a row".to_owned());
        }
        let mut row = Vec::with_capacity(width);
        loop {
            row.push(read_value(&mut chars)?);
            match chars.next() {
                Some(',') => {}
                Some(')') => break,
                _ => return Err("expected `,` or `)` after a value".to_owned()),
            }
        }
        if row.len() != width {
            return Err(format!("a row has {} values, not {width}", row.len()));
        }
        rows.push(row);
        match chars.next() {
            Some(',') => {}
            Some(';') if chars.peek().is_none() => return Ok(()),
            _ => return Err("expected `,` or `;` after a row".to_owned()),
        }
    }
}

fn read_value(chars: &mut std::iter::Peekable<std::str::Chars<'_>>) -> Result<Value, String> {
    if chars.peek() == Some(&'\'') {
        chars.next();
        let mut text = String::new();
        loop {
            match chars.next() {
                Some('\'') => return Ok(Value::Text(text)),
                Some('\\') => text.push(match chars.next() {
                    Some('0') => '\0',
                    Some('n') => '\n',
                    Some('r') => '\r',
                    Some('t') => '\t',
                    Some('Z') => '\x1a',
                    Some(other) => other,
                    None => return Err("a string ends in a backslash".to_owned()),
                }),
                Some(other) => text.push(other),
                None => return Err("a string isn't closed".to_owned()),
            }
        }
    }
    let mut bare = String::new();
    while let Some(&c) = chars.peek() {
        if c == ',' || c == ')' {
            break;
        }
        bare.push(c);
        chars.next();
    }
    if bare == "NULL" {
        Ok(Value::Null)
    } else if !bare.is_empty()
        && bare
            .chars()
            .all(|c| c.is_ascii_digit() || "-+.e".contains(c))
    {
        Ok(Value::Number(bare))
    } else {
        Err(format!("can't read the value {bare:?}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DUMP: &str = "\
CREATE TABLE `maps` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `map` varchar(64) NOT NULL,
  `tier` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;
INSERT INTO `maps` VALUES (1,'bhop_a',6),(2,'it\\'s \\\\ (a), map',NULL);
INSERT INTO `maps` VALUES (3,'bhop_c',-1.5e3);
";

    #[test]
    fn reads_columns_and_rows() {
        let table = read_table(DUMP, "maps").unwrap();
        assert_eq!(table.column("map"), Ok(1));
        assert!(table.column("points").is_err());
        assert_eq!(table.rows.len(), 3);
        assert_eq!(
            table.rows[1],
            [
                Value::Number("2".to_owned()),
                Value::Text("it's \\ (a), map".to_owned()),
                Value::Null
            ]
        );
        assert_eq!(table.rows[2][2], Value::Number("-1.5e3".to_owned()));
    }

    #[test]
    fn refuses_what_it_cant_read() {
        assert!(read_table(DUMP, "players").is_err());
        let short_row = DUMP.replace("(3,'bhop_c',-1.5e3)", "(3,'bhop_c')");
        assert!(read_table(&short_row, "maps").is_err());
        let hex = DUMP.replace("-1.5e3", "0x1F");
        assert!(read_table(&hex, "maps").is_err());
    }
}
